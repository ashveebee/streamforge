import { config } from './config.js';
import { db, readPref, writePref } from './lib/db.js';
import { cache } from './lib/cache.js';
import type { ServiceId } from './services/types.js';

/**
 * Runtime service settings.
 *
 * Each service resolves to either a row saved from the Settings page (SQLite)
 * or, when there is no row, the environment variables. A saved row replaces
 * the environment values completely; deleting it falls back to them again.
 * Changes apply immediately — clients are rebuilt on the next call.
 */

export const SERVICE_IDS: ServiceId[] = ['jellyfin', 'sonarr', 'radarr', 'lidarr', 'readarr', 'bazarr', 'prowlarr', 'seerr', 'infinidisk'];

export const SERVICE_NAMES: Record<ServiceId, string> = {
  jellyfin: 'Jellyfin',
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  prowlarr: 'Prowlarr',
  seerr: 'Seerr',
  infinidisk: 'Infinidisk',
  bazarr: 'Bazarr',
  lidarr: 'Lidarr',
  readarr: 'Readarr',
};

export interface ServiceSettings {
  url?: string;
  /** The address people open in their browser, when it differs from `url`. */
  publicUrl?: string;
  apiKey?: string;
  /** Infinidisk only. */
  authHeader?: string;
  statusPath?: string;
  healthPath?: string;
  mounts?: string[];
}

export type SettingsSource = 'database' | 'environment' | 'none';

export const INFINIDISK_DEFAULTS = { authHeader: 'X-Api-Key', statusPath: '/api/status' } as const;

/** Cache key prefixes to flush when a service's settings change. */
const CACHE_PREFIX: Record<ServiceId, string> = {
  jellyfin: 'jf:',
  sonarr: 'sonarr:',
  radarr: 'radarr:',
  prowlarr: 'prowlarr:',
  seerr: 'seerr:',
  infinidisk: 'infinidisk:',
  bazarr: 'bazarr:',
  lidarr: 'lidarr:',
  readarr: 'readarr:',
};

interface Row {
  service: string;
  data: string;
  updated_at: string;
  updated_by: string | null;
}

interface Stored {
  settings: ServiceSettings;
  updatedAt: string;
  updatedBy?: string;
}

const stored = new Map<ServiceId, Stored>();
for (const r of db.prepare('SELECT service, data, updated_at, updated_by FROM service_settings').all() as unknown as Row[]) {
  if (!SERVICE_IDS.includes(r.service as ServiceId)) continue;
  try {
    stored.set(r.service as ServiceId, {
      settings: JSON.parse(r.data) as ServiceSettings,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by ?? undefined,
    });
  } catch {
    console.warn(`[settings] Ignoring unreadable saved settings for ${r.service}`);
  }
}

/** Drops empty values so "blank" and "missing" mean the same thing. */
function clean(s: ServiceSettings): ServiceSettings {
  const out: ServiceSettings = {};
  for (const k of ['url', 'publicUrl', 'apiKey', 'authHeader', 'statusPath', 'healthPath'] as const) {
    const v = s[k]?.trim();
    if (v) out[k] = v;
  }
  if (s.mounts?.length) out.mounts = s.mounts.map((m) => m.trim()).filter(Boolean);
  if (!out.mounts?.length) delete out.mounts;
  return out;
}

function envSettings(id: ServiceId): ServiceSettings {
  return clean(config.envServices[id] as ServiceSettings);
}

/** True when the environment provides anything beyond defaults for a service. */
export function hasEnvSettings(id: ServiceId) {
  const e = envSettings(id);
  return !!(e.url || e.apiKey || e.mounts?.length);
}

export function isComplete(id: ServiceId, s: ServiceSettings) {
  switch (id) {
    case 'jellyfin':
      return !!s.url;
    case 'infinidisk':
      return !!s.url || !!s.mounts?.length;
    default:
      return !!(s.url && s.apiKey);
  }
}

export function resolve(id: ServiceId): { settings: ServiceSettings; source: SettingsSource; updatedAt?: string; updatedBy?: string } {
  const row = stored.get(id);
  if (row) return { settings: row.settings, source: 'database', updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  if (hasEnvSettings(id)) return { settings: envSettings(id), source: 'environment' };
  return { settings: {}, source: 'none' };
}

/** Current settings for a service, or undefined when it isn't fully set up. */
export function serviceSettings(id: ServiceId): ServiceSettings | undefined {
  const { settings } = resolve(id);
  return isComplete(id, settings) ? settings : undefined;
}

/* ---------------------------- enable/disable --------------------------- */

/**
 * Services can be switched off without losing their settings. A disabled
 * service is treated as not configured everywhere: no polling, no health
 * checks, and it disappears from the navigation and dashboard. Jellyfin is
 * always on because it handles sign-in.
 */
const disabled = new Set<ServiceId>(
  readPref<string[]>('disabledServices', []).filter((id): id is ServiceId => SERVICE_IDS.includes(id as ServiceId)),
);

export const canDisable = (id: ServiceId) => id !== 'jellyfin';

export function isEnabled(id: ServiceId) {
  return !disabled.has(id);
}

export function setEnabled(id: ServiceId, enabled: boolean) {
  if (!canDisable(id) || enabled === isEnabled(id)) return;
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  writePref('disabledServices', [...disabled]);
  changed(id);
}

/** Configured *and* enabled — i.e. StreamForge should talk to it. */
export function isConfigured(id: ServiceId) {
  return isEnabled(id) && !!serviceSettings(id);
}

/* --------------------------- change tracking --------------------------- */

let version = 0;
const listeners = new Set<(id: ServiceId) => void>();

export function onSettingsChange(fn: (id: ServiceId) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Signals that something a service depends on changed (e.g. its extra instances). */
export function notifyChanged(id: ServiceId) {
  changed(id);
}

function changed(id: ServiceId) {
  version++;
  cache.delete(CACHE_PREFIX[id]);
  for (const fn of listeners) fn(id);
}

/**
 * Returns a getter for a value derived from a service's settings (typically
 * an HTTP client). It is rebuilt whenever any settings change.
 */
export function derived<T>(id: ServiceId, build: (s: ServiceSettings) => T | undefined): () => T | undefined {
  let seen = -1;
  let value: T | undefined;
  return () => {
    if (seen !== version) {
      seen = version;
      const s = isEnabled(id) ? serviceSettings(id) : undefined;
      value = s ? build(s) : undefined;
    }
    return value;
  };
}

/* ------------------------------- writes -------------------------------- */

export function saveSettings(id: ServiceId, settings: ServiceSettings, updatedBy?: string) {
  const data = clean(settings);
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO service_settings (service, data, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(service) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(id, JSON.stringify(data), updatedAt, updatedBy ?? null);
  stored.set(id, { settings: data, updatedAt, updatedBy });
  changed(id);
}

/** Removes saved settings so the service falls back to the environment. */
export function resetSettings(id: ServiceId) {
  db.prepare('DELETE FROM service_settings WHERE service = ?').run(id);
  stored.delete(id);
  changed(id);
}

/* ------------------------------- helpers ------------------------------- */

/**
 * The address to send people to for a service (links such as "Play in
 * Jellyfin"): the public address when set, otherwise the server address.
 */
export function publicUrl(id: ServiceId) {
  const s = resolve(id).settings;
  return (s.publicUrl || s.url)?.replace(/\/+$/, '') || undefined;
}

export function infinidiskSettings(s: ServiceSettings) {
  return {
    baseUrl: s.url,
    apiKey: s.apiKey,
    authHeader: s.authHeader ?? INFINIDISK_DEFAULTS.authHeader,
    statusPath: s.statusPath ?? INFINIDISK_DEFAULTS.statusPath,
    healthPath: s.healthPath,
    mounts: s.mounts ?? [],
  };
}
export type InfinidiskSettings = ReturnType<typeof infinidiskSettings>;

/** A short, non-reversible hint for showing that a key is saved. */
export function keyHint(key?: string) {
  if (!key) return undefined;
  return key.length >= 12 ? `••••${key.slice(-4)}` : '••••';
}

export function describe(id: ServiceId) {
  const r = resolve(id);
  const s = r.settings;
  return {
    id,
    name: SERVICE_NAMES[id],
    source: r.source,
    configured: isComplete(id, s),
    enabled: isEnabled(id),
    canDisable: canDisable(id),
    envAvailable: hasEnvSettings(id),
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    url: s.url ?? '',
    publicUrl: s.publicUrl ?? '',
    apiKeySet: !!s.apiKey,
    apiKeyHint: keyHint(s.apiKey),
    ...(id === 'infinidisk'
      ? {
          authHeader: s.authHeader ?? INFINIDISK_DEFAULTS.authHeader,
          statusPath: s.statusPath ?? INFINIDISK_DEFAULTS.statusPath,
          healthPath: s.healthPath ?? '',
          mounts: s.mounts ?? [],
        }
      : {}),
  };
}

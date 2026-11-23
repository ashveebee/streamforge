import { config } from './config.js';
import { db } from './lib/db.js';
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

export const SERVICE_IDS: ServiceId[] = ['jellyfin', 'sonarr', 'radarr', 'prowlarr', 'seerr', 'infinidisk'];

export const SERVICE_NAMES: Record<ServiceId, string> = {
  jellyfin: 'Jellyfin',
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  prowlarr: 'Prowlarr',
  seerr: 'Seerr',
  infinidisk: 'Infinidisk',
};

export interface ServiceSettings {
  url?: string;
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
  for (const k of ['url', 'apiKey', 'authHeader', 'statusPath', 'healthPath'] as const) {
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

export function isConfigured(id: ServiceId) {
  return !!serviceSettings(id);
}

/* --------------------------- change tracking --------------------------- */

let version = 0;
const listeners = new Set<(id: ServiceId) => void>();

export function onSettingsChange(fn: (id: ServiceId) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
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
      const s = serviceSettings(id);
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
    envAvailable: hasEnvSettings(id),
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    url: s.url ?? '',
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

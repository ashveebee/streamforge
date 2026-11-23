import { randomBytes } from 'node:crypto';
import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { createClient, type ServiceClient } from '../lib/http.js';
import { isConfigured, isEnabled, keyHint, notifyChanged, onSettingsChange, serviceSettings } from '../settings.js';

/*
 * Sonarr/Radarr instances. The "primary" instance of each kind is the one
 * configured on the Settings card (or by environment variables) and keeps the
 * id `sonarr` / `radarr`. Additional instances (a 4K Radarr, an anime Sonarr,
 * …) are stored here with ids like `radarr-4k`.
 */

export type ArrKind = 'sonarr' | 'radarr';
export const ARR_KINDS: ArrKind[] = ['sonarr', 'radarr'];

export interface ArrInstance {
  id: string;
  kind: ArrKind;
  name: string;
  primary: boolean;
  client: ServiceClient;
}

interface StoredInstance {
  id: string;
  kind: ArrKind;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
}

const PREF = 'arrInstances';
let stored: StoredInstance[] = readPref<StoredInstance[]>(PREF, []).filter((s) => ARR_KINDS.includes(s.kind));
const clients = new Map<string, { key: string; client: ServiceClient }>();
const listeners = new Set<() => void>();

const NAMES: Record<ArrKind, string> = { sonarr: 'Sonarr', radarr: 'Radarr' };

function clientFor(id: string, kind: ArrKind, url: string, apiKey: string) {
  const key = `${url}\n${apiKey}`;
  const hit = clients.get(id);
  if (hit?.key === key) return hit.client;
  const client = createClient(kind, url, { 'X-Api-Key': apiKey });
  clients.set(id, { key, client });
  return client;
}

/** Every usable instance, primary first. */
export function arrInstances(kind?: ArrKind): ArrInstance[] {
  const out: ArrInstance[] = [];
  for (const k of kind ? [kind] : ARR_KINDS) {
    if (isConfigured(k)) {
      const s = serviceSettings(k)!;
      out.push({ id: k, kind: k, name: NAMES[k], primary: true, client: clientFor(k, k, s.url!, s.apiKey!) });
    }
    // Extra instances follow the kind's on/off switch in Settings.
    if (!isEnabled(k)) continue;
    for (const s of stored) {
      if (s.kind !== k || !s.enabled) continue;
      out.push({ id: s.id, kind: k, name: s.name, primary: false, client: clientFor(s.id, k, s.url, s.apiKey) });
    }
  }
  return out;
}

/**
 * Picks an instance by id, or the default (primary, else first extra) for a
 * kind. Undefined when nothing of that kind is set up.
 */
export function arrInstance(kind: ArrKind, id?: string): ArrInstance | undefined {
  const list = arrInstances(kind);
  return id ? list.find((i) => i.id === id) : list[0];
}

export const anyInstance = (kind: ArrKind) => arrInstances(kind).length > 0;

/* ------------------------------ management ------------------------------ */

export function describeInstances() {
  return stored.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    url: s.url,
    enabled: s.enabled,
    apiKeySet: !!s.apiKey,
    apiKeyHint: keyHint(s.apiKey),
    createdAt: s.createdAt,
  }));
}

export function getStoredInstance(id: string) {
  return stored.find((s) => s.id === id);
}

function save(kind: ArrKind, id: string) {
  writePref(PREF, stored);
  cache.delete(`${id}:`);
  clients.delete(id);
  // Fans out to onSettingsChange listeners, including the one below.
  notifyChanged(kind);
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

export function addInstance(input: { kind: ArrKind; name: string; url: string; apiKey: string }) {
  let id = `${input.kind}-${slug(input.name) || randomBytes(3).toString('hex')}`;
  if (stored.some((s) => s.id === id)) id = `${id}-${randomBytes(2).toString('hex')}`;
  const inst: StoredInstance = { ...input, id, enabled: true, createdAt: new Date().toISOString() };
  stored = [...stored, inst];
  save(input.kind, id);
  return inst;
}

export function updateInstance(id: string, patch: Partial<Pick<StoredInstance, 'name' | 'url' | 'apiKey' | 'enabled'>>) {
  const cur = stored.find((s) => s.id === id);
  if (!cur) return undefined;
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  stored = stored.map((s) => (s.id === id ? next : s));
  save(cur.kind, id);
  return next;
}

export function removeInstance(id: string) {
  const cur = stored.find((s) => s.id === id);
  if (!cur) return false;
  stored = stored.filter((s) => s.id !== id);
  save(cur.kind, id);
  return true;
}

/** Called when instances are added, changed or removed (or primary settings change). */
export function onInstancesChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

onSettingsChange((id) => {
  if (id === 'sonarr' || id === 'radarr') for (const fn of listeners) fn();
});

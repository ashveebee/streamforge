import { randomBytes } from 'node:crypto';
import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { keyHint, resolve } from '../settings.js';

/*
 * Extra media servers to monitor: more Jellyfin servers, Emby and Plex.
 *
 * The main Jellyfin server (Settings card or environment) handles sign-in
 * and everything user-specific. Extra servers are watched with their own API
 * key (a Plex token for Plex): health and outage alerts, active streams on
 * Now Playing, and an overview tab on the media server page.
 *
 * Ids carry the type: `jellyfin-cabin`, `emby-office`, `plex-loft`.
 */

export type MediaServerType = 'jellyfin' | 'emby' | 'plex';
export const MEDIA_SERVER_TYPES: MediaServerType[] = ['jellyfin', 'emby', 'plex'];
export const MEDIA_SERVER_NAMES: Record<MediaServerType, string> = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex' };

export interface MediaServer {
  id: string;
  type: MediaServerType;
  name: string;
  url: string;
  publicUrl?: string;
  /** Jellyfin/Emby API key, or a Plex token. */
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  /** The server's own id, when known (from discovery or a test). */
  serverId?: string;
}

// Kept as `jellyfinServers` so servers added before Plex/Emby support carry over.
const PREF = 'jellyfinServers';
let stored: MediaServer[] = readPref<Partial<MediaServer>[]>(PREF, [])
  .filter((s): s is MediaServer => !!s && typeof s.id === 'string' && !!s.url && !!s.apiKey)
  .map((s) => ({ ...s, type: MEDIA_SERVER_TYPES.includes(s.type as MediaServerType) ? s.type : 'jellyfin' }));
const listeners = new Set<() => void>();

export const SERVER_ID_RE = /^(jellyfin|emby|plex)-[a-z0-9-]{1,40}$/;

/** Extra servers StreamForge should talk to (switched on). */
export function mediaServers(type?: MediaServerType) {
  return stored.filter((s) => s.enabled && (!type || s.type === type));
}

export function mediaServer(id: string) {
  return mediaServers().find((s) => s.id === id);
}

export function getStoredServer(id: string) {
  return stored.find((s) => s.id === id);
}

export function describeServers() {
  return stored.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    url: s.url,
    publicUrl: s.publicUrl ?? '',
    enabled: s.enabled,
    apiKeySet: !!s.apiKey,
    apiKeyHint: keyHint(s.apiKey),
    createdAt: s.createdAt,
  }));
}

/** Origins of every media server already set up, main Jellyfin server included. */
export function knownOrigins() {
  const urls = [resolve('jellyfin').settings.url, ...stored.map((s) => s.url)];
  return new Set(urls.filter((u): u is string => !!u).map(originOf));
}

export function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function save(id: string) {
  writePref(PREF, stored);
  cache.delete(`jfx:${id}:`);
  cache.delete(`plex:${id}:`);
  for (const fn of listeners) fn();
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

export function addServer(input: { type: MediaServerType; name: string; url: string; publicUrl?: string; apiKey: string; serverId?: string }) {
  let id = `${input.type}-${slug(input.name) || randomBytes(3).toString('hex')}`;
  if (stored.some((s) => s.id === id)) id = `${id}-${randomBytes(2).toString('hex')}`;
  const server: MediaServer = {
    id,
    type: input.type,
    name: input.name,
    url: input.url,
    publicUrl: input.publicUrl || undefined,
    apiKey: input.apiKey,
    serverId: input.serverId,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  stored = [...stored, server];
  save(id);
  return server;
}

export function updateServer(id: string, patch: Partial<Pick<MediaServer, 'name' | 'url' | 'publicUrl' | 'apiKey' | 'enabled' | 'serverId'>>) {
  const cur = stored.find((s) => s.id === id);
  if (!cur) return undefined;
  const next: MediaServer = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (next.publicUrl === '') delete next.publicUrl;
  stored = stored.map((s) => (s.id === id ? next : s));
  save(id);
  return next;
}

export function removeServer(id: string) {
  if (!stored.some((s) => s.id === id)) return false;
  stored = stored.filter((s) => s.id !== id);
  save(id);
  return true;
}

/** Called when extra servers are added, changed or removed. */
export function onServersChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

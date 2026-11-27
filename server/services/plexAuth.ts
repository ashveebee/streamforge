import { randomBytes } from 'node:crypto';
import { buildUrl, requestJson, UpstreamError } from '../lib/http.js';
import { readPref, writePref } from '../lib/db.js';
import { VERSION } from '../version.js';

/*
 * Signing in with a Plex account.
 *
 * Plex's own flow for apps: we ask plex.tv for a PIN, the browser opens
 * app.plex.tv to approve it, and we poll until plex.tv hands back an account
 * token. With that token we read the account and the servers it can use, and
 * a person may sign in when their account has access to the main Plex server.
 * The server's owner is an administrator; everyone it's shared with is a
 * member.
 */

// Overridable for tests against a stand-in for plex.tv.
const PLEX_TV = process.env.PLEX_TV_URL || 'https://plex.tv';

/** A stable id for this StreamForge install, as Plex expects from every app. */
export function clientId() {
  let id = readPref<string | null>('plexClientId', null);
  if (!id) {
    id = `streamforge-${randomBytes(12).toString('hex')}`;
    writePref('plexClientId', id);
  }
  return id;
}

export function plexHeaders(token?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Product': 'StreamForge',
    'X-Plex-Version': VERSION,
    'X-Plex-Client-Identifier': clientId(),
    'X-Plex-Device-Name': 'StreamForge',
    'X-Plex-Platform': 'Web',
    ...(token ? { 'X-Plex-Token': token } : {}),
  };
}

/* ---------------------------------- PINs ---------------------------------- */

interface Pin {
  id: number;
  code: string;
  authToken?: string | null;
  expiresAt?: string;
}

/**
 * Pending sign-ins, keyed by a random handle only the browser that started
 * the sign-in knows. The Plex PIN id itself never leaves the server.
 */
const pending = new Map<string, { pinId: number; expires: number; token?: string }>();

function sweep() {
  const now = Date.now();
  for (const [k, p] of pending) if (p.expires < now) pending.delete(k);
}

/** Starts a sign-in: returns a handle to poll and the address to approve it at. */
export async function startPin() {
  sweep();
  if (pending.size > 200) throw new UpstreamError('Too many sign-ins in progress. Try again in a minute.', 429, 'plex');
  const pin = await requestJson<Pin>(buildUrl(PLEX_TV, '/api/v2/pins', { strong: true }), { method: 'POST', headers: plexHeaders(), service: 'plex' });
  const handle = randomBytes(24).toString('base64url');
  pending.set(handle, { pinId: pin.id, expires: Date.now() + 10 * 60_000 });
  const params = new URLSearchParams({ clientID: clientId(), code: pin.code, 'context[device][product]': 'StreamForge' });
  return { handle, authUrl: `https://app.plex.tv/auth#?${params}` };
}

/** The account token once the person approved the sign-in; undefined while waiting. */
export async function pollPin(handle: string): Promise<string | undefined> {
  const p = pending.get(handle);
  if (!p || p.expires < Date.now()) {
    pending.delete(handle);
    throw new UpstreamError('This sign-in has expired. Start again.', 410, 'plex');
  }
  if (p.token) return p.token;
  const pin = await requestJson<Pin>(buildUrl(PLEX_TV, `/api/v2/pins/${p.pinId}`), { headers: plexHeaders(), service: 'plex' });
  if (pin.authToken) p.token = pin.authToken;
  return p.token;
}

/** Forgets a finished sign-in. */
export const finishPin = (handle: string) => pending.delete(handle);

/* ------------------------------ account, servers ------------------------------ */

export interface PlexAccount {
  id: number;
  uuid?: string;
  username?: string;
  title?: string;
  email?: string;
  thumb?: string;
}

export async function account(token: string) {
  return requestJson<PlexAccount>(buildUrl(PLEX_TV, '/api/v2/user'), { headers: plexHeaders(token), service: 'plex' });
}

export interface PlexResource {
  name: string;
  clientIdentifier: string;
  provides: string;
  owned: boolean;
  accessToken?: string;
  productVersion?: string;
  connections?: { uri: string; local: boolean; relay: boolean; protocol?: string }[];
}

/** Plex servers the account can use (its own and ones shared with it). */
export async function servers(token: string) {
  const list = await requestJson<PlexResource[]>(buildUrl(PLEX_TV, '/api/v2/resources', { includeHttps: 1, includeRelay: 0 }), {
    headers: plexHeaders(token),
    service: 'plex',
  });
  return list.filter((r) => r.provides.split(',').includes('server'));
}

/**
 * The first address of a server that answers from here and is really that
 * server. Local addresses first (fastest), then the server's remote ones.
 */
export async function reachableUri(r: PlexResource): Promise<string | undefined> {
  const conns = [...(r.connections ?? [])].filter((c) => !c.relay).sort((a, b) => Number(b.local) - Number(a.local));
  for (const c of conns) {
    const ident = await requestJson<{ MediaContainer?: { machineIdentifier?: string } }>(buildUrl(c.uri, '/identity'), {
      headers: { Accept: 'application/json' },
      service: 'plex',
      timeoutMs: 4000,
    }).catch(() => undefined);
    if (ident?.MediaContainer?.machineIdentifier === r.clientIdentifier) return c.uri.replace(/\/+$/, '');
  }
  return undefined;
}

/** How a Plex account relates to a server: no access, a member, or the owner (admin). */
export async function accessTo(token: string, serverId: string) {
  const r = (await servers(token)).find((s) => s.clientIdentifier === serverId);
  return r ? { isAdmin: r.owned, serverToken: r.accessToken } : undefined;
}

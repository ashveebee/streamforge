import { randomBytes } from 'node:crypto';
import { readPref, writePref } from '../../lib/db.js';
import { keyHint } from '../../settings.js';
import { emit } from '../notify.js';
import { nzbget } from './nzbget.js';
import { qbittorrent } from './qbittorrent.js';
import { sabnzbd } from './sabnzbd.js';
import { transmission } from './transmission.js';
import { CLIENT_TYPES, type ClientAdapter, type ClientConfig, type ClientSnapshot, type ClientType, type ItemAction } from './types.js';

export { CLIENT_TYPES, type ClientType, type ItemAction };

/*
 * Download clients (qBittorrent, Transmission, SABnzbd, NZBGet). Sampled
 * every 5 seconds while any is set up, which gives real transfer speeds,
 * per-download progress and a short speed history. Passwords and API keys
 * stay on the server.
 */

export const CLIENT_NAMES: Record<ClientType, string> = { qbittorrent: 'qBittorrent', transmission: 'Transmission', sabnzbd: 'SABnzbd', nzbget: 'NZBGet' };
const FACTORIES: Record<ClientType, (c: ClientConfig) => ClientAdapter> = { qbittorrent, transmission, sabnzbd, nzbget };
/** Which credential fields each type uses. */
export const CLIENT_FIELDS: Record<ClientType, ('username' | 'password' | 'apiKey')[]> = {
  qbittorrent: ['username', 'password'],
  transmission: ['username', 'password'],
  sabnzbd: ['apiKey'],
  nzbget: ['username', 'password'],
};

const PREF = 'downloadClients';
let stored: ClientConfig[] = readPref<ClientConfig[]>(PREF, []).filter((c) => CLIENT_TYPES.includes(c.type));
const adapters = new Map<string, { key: string; adapter: ClientAdapter }>();

export function adapterFor(c: ClientConfig) {
  const key = JSON.stringify([c.type, c.url, c.username, c.password, c.apiKey]);
  const hit = adapters.get(c.id);
  if (hit?.key === key) return hit.adapter;
  const adapter = FACTORIES[c.type](c);
  adapters.set(c.id, { key, adapter });
  return adapter;
}

export const enabledClients = () => stored.filter((c) => c.enabled);
export const getClient = (id: string) => stored.find((c) => c.id === id);
export const hasClients = () => enabledClients().length > 0;

/* ------------------------------- sampling ------------------------------- */

interface State {
  snapshot?: ClientSnapshot;
  error?: string;
  lastCheck?: string;
  lastSuccess?: string;
  latencyMs?: number;
  failures: number;
  alerted: boolean;
}
const state = new Map<string, State>();
const history: { t: number; down: number; up: number }[] = [];
const SAMPLE_MS = 5_000;

async function sampleOne(c: ClientConfig) {
  const s = state.get(c.id) ?? { failures: 0, alerted: false };
  state.set(c.id, s);
  const started = performance.now();
  s.lastCheck = new Date().toISOString();
  try {
    s.snapshot = await adapterFor(c).snapshot();
    s.latencyMs = Math.round(performance.now() - started);
    s.lastSuccess = s.lastCheck;
    s.error = undefined;
    s.failures = 0;
    if (s.alerted) {
      s.alerted = false;
      emit('service_up', { title: `${c.name} is back online`, message: `${c.name} is responding again.`, url: '/downloads' });
    }
  } catch (err) {
    s.error = (err as Error).message;
    s.snapshot = undefined;
    // Two failures in a row before alerting, like the other services.
    if (++s.failures === 2 && !s.alerted) {
      s.alerted = true;
      emit('service_down', { title: `${c.name} is offline`, message: s.error, url: '/downloads' });
    }
  }
}

async function sample() {
  const list = enabledClients();
  for (const id of state.keys()) if (!list.some((c) => c.id === id)) state.delete(id);
  if (!list.length) return;
  await Promise.all(list.map(sampleOne));
  const snaps = [...state.values()].map((s) => s.snapshot).filter(Boolean) as ClientSnapshot[];
  history.push({ t: Date.now(), down: snaps.reduce((n, s) => n + s.downSpeed, 0), up: snaps.reduce((n, s) => n + s.upSpeed, 0) });
  if (history.length > 180) history.shift();
}

export function startClientSampler() {
  void sample();
  setInterval(() => void sample(), SAMPLE_MS).unref();
}

/** Current combined speeds, or undefined when no client is set up. */
export function clientTotals() {
  if (!hasClients()) return undefined;
  const last = history.at(-1);
  return last ? { down: last.down, up: last.up } : { down: 0, up: 0 };
}

export function clientsSnapshot() {
  return {
    clients: enabledClients().map((c) => {
      const s = state.get(c.id);
      return {
        id: c.id,
        type: c.type,
        typeName: CLIENT_NAMES[c.type],
        name: c.name,
        online: !!s?.snapshot,
        error: s?.error,
        lastCheck: s?.lastCheck,
        lastSuccess: s?.lastSuccess,
        latencyMs: s?.latencyMs,
        ...(s?.snapshot ?? {}),
      };
    }),
    history,
    sampleIntervalMs: SAMPLE_MS,
  };
}

/** Refreshes one client right after an action so the UI sees the result. */
export async function refreshClient(id: string) {
  const c = getClient(id);
  if (c) await sampleOne(c);
}

/* ------------------------------ management ------------------------------ */

export function describeClients() {
  return stored.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    url: c.url,
    username: c.username ?? '',
    enabled: c.enabled,
    passwordSet: !!c.password,
    apiKeySet: !!c.apiKey,
    apiKeyHint: keyHint(c.apiKey),
    createdAt: c.createdAt,
  }));
}

function save() {
  writePref(PREF, stored);
  void sample();
}

export function addClient(input: Omit<ClientConfig, 'id' | 'createdAt' | 'enabled'>) {
  const c: ClientConfig = { ...input, id: randomBytes(4).toString('hex'), enabled: true, createdAt: new Date().toISOString() };
  stored = [...stored, c];
  save();
  return c;
}

export function updateClient(id: string, patch: Partial<Pick<ClientConfig, 'name' | 'url' | 'username' | 'password' | 'apiKey' | 'enabled'>>) {
  const cur = getClient(id);
  if (!cur) return undefined;
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  stored = stored.map((c) => (c.id === id ? next : c));
  adapters.delete(id);
  state.delete(id);
  save();
  return next;
}

export function removeClient(id: string) {
  const before = stored.length;
  stored = stored.filter((c) => c.id !== id);
  adapters.delete(id);
  state.delete(id);
  save();
  return stored.length !== before;
}

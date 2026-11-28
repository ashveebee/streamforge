import { randomBytes } from 'node:crypto';
import { config } from '../../config.js';
import { readPref, writePref } from '../../lib/db.js';
import { keyHint } from '../../settings.js';
import { emit } from '../notify.js';
import { nzbget } from './nzbget.js';
import { qbittorrent } from './qbittorrent.js';
import { sabnzbd } from './sabnzbd.js';
import { transmission } from './transmission.js';
import { CLIENT_TYPES, type ClientAdapter, type ClientConfig, type ClientItem, type ClientSnapshot, type ClientType, type ItemAction } from './types.js';

export { CLIENT_TYPES, type ClientType, type ItemAction };

/*
 * Download clients (qBittorrent, Transmission, SABnzbd, NZBGet). Sampled
 * every CLIENT_SAMPLE_INTERVAL_SECONDS (5 by default) while any is set up, which gives real transfer speeds,
 * per-download progress and a short speed history. Passwords and API keys
 * stay on the server.
 */

export const CLIENT_NAMES: Record<ClientType, string> = { qbittorrent: 'qBittorrent', transmission: 'Transmission', sabnzbd: 'SABnzbd', nzbget: 'NZBGet' };
const FACTORIES: Record<ClientType, (c: ClientConfig) => ClientAdapter> = { qbittorrent, transmission, sabnzbd, nzbget };
/** Which credential fields each type uses. */
export const CLIENT_FIELDS: Record<ClientType, ('username' | 'password' | 'apiKey')[]> = {
  qbittorrent: ['username', 'password', 'apiKey'],
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

/*
 * Each client is sampled on its own schedule. A client is never asked again
 * while its previous sample is still running, and one that is slow or failing
 * is asked less often (doubling up to MAX_BACKOFF_MS) until it answers quickly
 * again, so a large or struggling client is never flooded with requests.
 */

/** Item counts the Downloads page shows, worked out over every item, not just the ones sent. */
export interface ItemSummary {
  total: number;
  downloading: number;
  active: number;
  seeding: number;
  paused: number;
  error: number;
  /** Bytes still to download. */
  remaining: number;
}

interface State {
  snapshot?: ClientSnapshot;
  summary?: ItemSummary;
  /** The items sent to the browser, at most ITEM_LIMIT of them. */
  shown?: ClientItem[];
  error?: string;
  lastCheck?: string;
  lastSuccess?: string;
  latencyMs?: number;
  failures: number;
  alerted: boolean;
  inFlight?: Promise<void>;
  /** Current gap between samples; grows while the client is slow or failing. */
  intervalMs: number;
  nextAt: number;
}
const state = new Map<string, State>();
const history: { t: number; down: number; up: number }[] = [];
const SAMPLE_MS = config.clientSampleIntervalMs;
const MAX_BACKOFF_MS = Math.max(SAMPLE_MS, 5 * 60_000);
/* Large libraries (tens of thousands of torrents) stay on the server; the browser gets the ones worth looking at. */
export const ITEM_LIMIT = 500;

const stateFor = (id: string) => {
  let s = state.get(id);
  if (!s) state.set(id, (s = { failures: 0, alerted: false, intervalMs: SAMPLE_MS, nextAt: 0 }));
  return s;
};

const ACTIVE: ClientItem['state'][] = ['downloading', 'stalled', 'queued', 'checking'];

export function summarise(items: ClientItem[]): ItemSummary {
  const sum: ItemSummary = { total: items.length, downloading: 0, active: 0, seeding: 0, paused: 0, error: 0, remaining: 0 };
  for (const i of items) {
    if (i.state === 'downloading') sum.downloading++;
    if (ACTIVE.includes(i.state)) sum.active++;
    else if (i.state === 'seeding' || i.state === 'completed') sum.seeding++;
    else if (i.state === 'paused') sum.paused++;
    else if (i.state === 'error') sum.error++;
    if (i.state !== 'seeding' && i.state !== 'completed') sum.remaining += Math.max(0, i.size - i.downloaded);
  }
  return sum;
}

/* Errors and transfers first, then paused, then seeding; fastest first within each. */
const rank = (i: ClientItem) =>
  i.state === 'error' ? 0 : ACTIVE.includes(i.state) ? 1 : i.state === 'paused' ? 2 : i.upSpeed > 0 ? 3 : 4;

export function pickShown(items: ClientItem[], limit = ITEM_LIMIT): ClientItem[] {
  if (items.length <= limit) return items;
  return [...items]
    .sort((a, b) => rank(a) - rank(b) || b.downSpeed + b.upSpeed - (a.downSpeed + a.upSpeed) || (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
    .slice(0, limit);
}

async function run(c: ClientConfig, s: State) {
  const started = performance.now();
  s.lastCheck = new Date().toISOString();
  let ok = false;
  try {
    const snap = await adapterFor(c).snapshot();
    s.snapshot = snap;
    s.summary = summarise(snap.items);
    s.shown = pickShown(snap.items);
    s.latencyMs = Math.round(performance.now() - started);
    s.lastSuccess = s.lastCheck;
    s.error = undefined;
    s.failures = 0;
    ok = true;
    if (s.alerted) {
      s.alerted = false;
      emit('service_up', { title: `${c.name} is back online`, message: `${c.name} is responding again.`, url: '/downloads' });
    }
  } catch (err) {
    s.error = (err as Error).message;
    s.snapshot = s.summary = s.shown = undefined;
    // Two failures in a row before alerting, like the other services.
    if (++s.failures === 2 && !s.alerted) {
      s.alerted = true;
      emit('service_down', { title: `${c.name} is offline`, message: s.error, url: '/downloads' });
    }
  }
  const took = performance.now() - started;
  // Back off when the client failed or took longer than the interval; return to normal once it answers quickly.
  s.intervalMs = ok && took <= SAMPLE_MS ? SAMPLE_MS : Math.min(s.intervalMs * 2, MAX_BACKOFF_MS);
  s.nextAt = Date.now() + s.intervalMs;
}

/** Samples a client unless a sample is already running, in which case it waits for that one. */
function sampleOne(c: ClientConfig): Promise<void> {
  const s = stateFor(c.id);
  if (!s.inFlight) s.inFlight = run(c, s).finally(() => (s.inFlight = undefined));
  return s.inFlight;
}

function tick() {
  const list = enabledClients();
  for (const id of state.keys()) if (!list.some((c) => c.id === id)) state.delete(id);
  const now = Date.now();
  for (const c of list) {
    const s = stateFor(c.id);
    if (!s.inFlight && now >= s.nextAt) void sampleOne(c);
  }
}

function record() {
  if (!hasClients()) return;
  const snaps = [...state.values()].map((s) => s.snapshot).filter(Boolean) as ClientSnapshot[];
  history.push({ t: Date.now(), down: snaps.reduce((n, s) => n + s.downSpeed, 0), up: snaps.reduce((n, s) => n + s.upSpeed, 0) });
  if (history.length > 180) history.shift();
}

export function startClientSampler() {
  tick();
  setInterval(tick, Math.min(1000, SAMPLE_MS)).unref();
  setInterval(record, SAMPLE_MS).unref();
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
        items: s?.shown,
        summary: s?.summary,
      };
    }),
    history,
    sampleIntervalMs: SAMPLE_MS,
  };
}

/** Refreshes one client right after an action so the UI sees the result. */
export async function refreshClient(id: string) {
  const c = getClient(id);
  if (!c) return;
  // A sample that started before the action may not include it, so let it finish and take a fresh one.
  await state.get(id)?.inFlight;
  await sampleOne(c);
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
  tick();
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

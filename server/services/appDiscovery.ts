import { readFileSync } from 'node:fs';
import { isConfigured, resolve, SERVICE_NAMES } from '../settings.js';
import type { ServiceId } from './types.js';
import { mainExtra } from './mainServer.js';
import { prowlarr } from './prowlarr.js';
import { seerr } from './seerr.js';

/*
 * Finding the apps around the media server, for first-run setup.
 *
 * Sonarr, Radarr and friends don't announce themselves on the network, so
 * we look where they usually are and ask each address what it is:
 *
 * - Docker service names on their default ports (http://sonarr:8989), for
 *   StreamForge running in the same Compose project;
 * - this machine, Docker's host gateway and the media server's machine, on
 *   the default ports;
 * - sibling subdomains over HTTPS (jellyfin.example.com → sonarr.example.com),
 *   for reverse-proxy setups. The media server's address and those of apps
 *   already connected are the hints for both machines and domains.
 *
 * Each answer is identified from the app's own unauthenticated page (its
 * HTML title, or Seerr's public status endpoint). Nothing here needs or
 * reads an API key.
 *
 * Apps that are already connected know about the others: Seerr stores its
 * Sonarr/Radarr servers and Prowlarr its applications, keys included, so
 * `fromConnectedApps` can fill those in without anyone copying keys around.
 * Keys found that way stay on the server.
 */

export type AppId = Extract<ServiceId, 'sonarr' | 'radarr' | 'prowlarr' | 'lidarr' | 'readarr' | 'bazarr' | 'seerr'>;

interface AppMeta {
  id: AppId;
  port: number;
  /** Docker service / subdomain names it usually runs under. */
  names: string[];
}

export const APPS: AppMeta[] = [
  { id: 'sonarr', port: 8989, names: ['sonarr'] },
  { id: 'radarr', port: 7878, names: ['radarr'] },
  { id: 'prowlarr', port: 9696, names: ['prowlarr'] },
  { id: 'seerr', port: 5055, names: ['seerr', 'jellyseerr', 'overseerr', 'requests'] },
  { id: 'bazarr', port: 6767, names: ['bazarr'] },
  { id: 'lidarr', port: 8686, names: ['lidarr'] },
  { id: 'readarr', port: 8787, names: ['readarr'] },
];

/** Title words → app. Seerr is also known by its forks' names. */
const TITLES: [RegExp, AppId, string][] = [
  [/\bsonarr\b/i, 'sonarr', 'Sonarr'],
  [/\bradarr\b/i, 'radarr', 'Radarr'],
  [/\bprowlarr\b/i, 'prowlarr', 'Prowlarr'],
  [/\blidarr\b/i, 'lidarr', 'Lidarr'],
  [/\breadarr\b/i, 'readarr', 'Readarr'],
  [/\bbazarr\b/i, 'bazarr', 'Bazarr'],
  [/\bjellyseerr\b/i, 'seerr', 'Jellyseerr'],
  [/\boverseerr\b/i, 'seerr', 'Overseerr'],
  [/\bseerr\b/i, 'seerr', 'Seerr'],
];

export interface FoundApp {
  service: AppId;
  /** What the app calls itself, e.g. "Jellyseerr". */
  name: string;
  url: string;
  /** Where it was found: a Docker service name, a host and port, or a subdomain. */
  via: 'docker' | 'host' | 'domain';
}

const TIMEOUT_MS = 2500;

/** Docker's default gateway (the host) inside a Linux container, from the routing table. */
function gateway() {
  try {
    for (const line of readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, dest, gw] = line.trim().split(/\s+/);
      if (dest === '00000000' && gw && gw !== '00000000') {
        // Little-endian hex → dotted quad.
        return [6, 4, 2, 0].map((i) => parseInt(gw.slice(i, i + 2), 16)).join('.');
      }
    }
  } catch {
    // Not Linux, or no permission: fall through.
  }
  return undefined;
}

function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

/** Every address worth asking, best first, each tagged with the app expected there. */
function candidates(): { url: string; expect: AppId; via: FoundApp['via'] }[] {
  // The media server and any app already connected are hints: their machines
  // and domains are where the other apps usually live too.
  const known = [mainExtra()?.url, ...(['jellyfin', ...APPS.map((a) => a.id)] as ServiceId[]).map((id) => (isConfigured(id) ? resolve(id).settings.url : undefined))];
  // Plex's relay addresses (*.plex.direct) say nothing about where other apps are.
  const knownHosts = [...new Set(known.map(hostOf).filter((h): h is string => !!h && !h.endsWith('.plex.direct')))];
  const hosts = [...new Set(['host.docker.internal', gateway(), ...knownHosts.filter(isIp), ...knownHosts.filter((h) => !isIp(h) && h.split('.').length < 3), 'localhost'].filter((h): h is string => !!h))];
  // jellyfin.example.com → sonarr.example.com
  const parents = [...new Set(knownHosts.filter((h) => !isIp(h) && h.split('.').length >= 3).map((h) => h.split('.').slice(1).join('.')))];
  const out: { url: string; expect: AppId; via: FoundApp['via'] }[] = [];
  for (const app of APPS) for (const name of app.names) out.push({ url: `http://${name}:${app.port}`, expect: app.id, via: 'docker' });
  for (const app of APPS) for (const h of hosts) out.push({ url: `http://${h.includes(':') ? `[${h}]` : h}:${app.port}`, expect: app.id, via: 'host' });
  for (const parent of parents) for (const app of APPS) for (const name of app.names) out.push({ url: `https://${name}.${parent}`, expect: app.id, via: 'domain' });
  return out;
}

async function fetchText(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow', headers: { Accept: 'text/html,application/json' } });
  const text = (await res.text()).slice(0, 64_000);
  return { status: res.status, text, finalUrl: res.url };
}

/** What's answering at an address, if it's one of the apps. */
async function identify(c: { url: string; expect: AppId }): Promise<{ service: AppId; name: string } | undefined> {
  try {
    const page = await fetchText(`${c.url}/`);
    const title = page.text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '';
    for (const [re, service, name] of TITLES) if (re.test(title)) return { service, name };
    if (c.expect === 'seerr') {
      // Seerr's title can be renamed; its public status endpoint can't.
      const status = await fetchText(`${c.url}/api/v1/status`);
      const json = JSON.parse(status.text) as { version?: string; commitTag?: string };
      if (status.status === 200 && json.version && 'commitTag' in json) return { service: 'seerr', name: 'Seerr' };
    } else if (page.status === 401) {
      // Basic auth hides the page; the *arr apps still answer /ping without it.
      const ping = await fetchText(`${c.url}/ping`);
      if (ping.status === 200 && /"status"\s*:\s*"OK"/i.test(ping.text)) return { service: c.expect, name: SERVICE_NAMES[c.expect] };
    }
  } catch {
    // Nothing there, or not reachable from here.
  }
  return undefined;
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

let scanning: Promise<FoundApp[]> | undefined;

/** Looks for the apps; one scan at a time, concurrent callers share it. Takes a few seconds. */
export function discoverApps() {
  scanning ??= (async () => {
    const list = candidates();
    const answers = await pool(list, 24, identify);
    const found = new Map<AppId, FoundApp>();
    list.forEach((c, i) => {
      const a = answers[i];
      // The first (best) address for each app wins.
      if (a && !found.has(a.service)) found.set(a.service, { service: a.service, name: a.name, url: c.url, via: c.via });
    });
    return APPS.map((a) => found.get(a.id)).filter((x): x is FoundApp => !!x);
  })().finally(() => (scanning = undefined));
  return scanning;
}

/** An app's address and key, read from another app that's already connected. */
export interface Borrowed {
  service: AppId;
  url: string;
  apiKey: string;
  from: 'seerr' | 'prowlarr';
}

const masked = (k: string | undefined) => !k || /^\*+$/.test(k);

/**
 * Sonarr/Radarr (and Lidarr/Readarr) details stored in Seerr and Prowlarr,
 * for apps StreamForge isn't connected to yet. Server-side only: the keys
 * never reach the browser.
 */
export async function fromConnectedApps(): Promise<Borrowed[]> {
  const out: Borrowed[] = [];
  const want = (id: AppId) => !isConfigured(id) && !out.some((b) => b.service === id);
  if (isConfigured('seerr')) {
    type SeerrArr = { hostname?: string; port?: number; useSsl?: boolean; baseUrl?: string; apiKey?: string; isDefault?: boolean; is4k?: boolean };
    for (const kind of ['sonarr', 'radarr'] as const) {
      const list = await seerr()!
        .get<SeerrArr[]>(`/api/v1/settings/${kind}`)
        .catch(() => [] as SeerrArr[]);
      // The default non-4K server first.
      const s = [...list].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault) || Number(!!a.is4k) - Number(!!b.is4k))[0];
      if (s?.hostname && s.port && !masked(s.apiKey) && want(kind)) {
        out.push({ service: kind, url: `${s.useSsl ? 'https' : 'http'}://${s.hostname}:${s.port}${(s.baseUrl ?? '').replace(/\/+$/, '')}`, apiKey: s.apiKey!, from: 'seerr' });
      }
    }
  }
  if (isConfigured('prowlarr')) {
    type App = { implementation?: string; fields?: { name: string; value?: unknown }[] };
    const apps = await prowlarr()!
      .get<App[]>('/api/v1/applications')
      .catch(() => [] as App[]);
    for (const a of apps) {
      const id = a.implementation?.toLowerCase() as AppId | undefined;
      if (!id || !['sonarr', 'radarr', 'lidarr', 'readarr'].includes(id) || !want(id)) continue;
      const field = (n: string) => a.fields?.find((f) => f.name === n)?.value;
      const url = typeof field('baseUrl') === 'string' ? (field('baseUrl') as string).replace(/\/+$/, '') : undefined;
      const apiKey = typeof field('apiKey') === 'string' ? (field('apiKey') as string) : undefined;
      if (url && /^https?:\/\//.test(url) && !masked(apiKey)) out.push({ service: id, url, apiKey: apiKey!, from: 'prowlarr' });
    }
  }
  return out;
}

import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { isConfigured, resolve } from '../settings.js';
import * as jellyfin from './jellyfin.js';
import { getStoredServer, mediaServers, type MediaServer } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * The main media server: the one people sign in with.
 *
 * It's Jellyfin by default. A household that only runs Plex or Emby can make
 * that server the main one instead: people then sign in with their Plex or
 * Emby account, and everything that used to read the main Jellyfin server
 * (the dashboard, stats, your page, search, library health, alerts) reads
 * that server.
 *
 * A main Plex or Emby server is stored with the other media servers (so it
 * gets health checks, Now Playing and its page like any other) and named here.
 */

export type MainType = 'jellyfin' | 'plex' | 'emby';

interface MainPref {
  type: MainType;
  /** The media server id of the main Plex or Emby server. */
  id?: string;
}

const PREF = 'mainServer';
let pref: MainPref = readPref<MainPref>(PREF, { type: 'jellyfin' });

/** The main Plex or Emby server, when one of them is the sign-in server. */
export function mainExtra(): MediaServer | undefined {
  if (pref.type === 'jellyfin' || !pref.id) return undefined;
  const s = getStoredServer(pref.id);
  return s?.type === pref.type ? s : undefined;
}

export const mainPlex = () => (mainExtra()?.type === 'plex' ? mainExtra() : undefined);
export const mainEmby = () => (mainExtra()?.type === 'emby' ? mainExtra() : undefined);

/** True when people sign in with Plex. */
export const plexMode = () => !!mainPlex();
/** True when people sign in with Emby. */
export const embyMode = () => !!mainEmby();
/** True when the sign-in server is Plex or Emby rather than Jellyfin. */
export const notJellyfinMain = () => !!mainExtra();

/** Which kind of server people sign in with. */
export const mainType = (): MainType => mainExtra()?.type ?? 'jellyfin';
export const mainName = () => ({ jellyfin: 'Jellyfin', plex: 'Plex', emby: 'Emby' })[mainType()];

/** True once a main server is set up (any kind). */
export const mediaReady = () => notJellyfinMain() || isConfigured('jellyfin');

export function setMainServer(type: 'plex' | 'emby', id: string) {
  pref = { type, id };
  writePref(PREF, pref);
}

export function clearMainServer() {
  pref = { type: 'jellyfin' };
  writePref(PREF, pref);
}

export const isMainServer = (id: string) => pref.type !== 'jellyfin' && pref.id === id;

/** Active streams on the main server, for background features (recorder, alerts, rules). */
export async function mainNowPlaying(): Promise<jellyfin.NowPlaying[] | undefined> {
  const m = mainExtra();
  if (m) return m.type === 'plex' ? plex.nowPlaying(m) : jellyfin.remoteNowPlaying(m);
  return jellyfin.serverNowPlaying();
}

/** Whether background features can read the main server without a signed-in user. */
export const canWatchInBackground = () => notJellyfinMain() || jellyfin.hasServerKey();

/** Controls a stream on the main server from a background feature. */
export async function controlMainSession(sessionId: string, command: jellyfin.SessionCommand, text?: string) {
  const m = mainExtra();
  if (!m) return jellyfin.controlSessionAsServer(sessionId, command, text);
  if (m.type === 'emby') return jellyfin.controlRemoteSession(m, sessionId, command, text);
  // Plex can only end a stream; the message becomes the reason shown to the viewer.
  if (command === 'stop') return plex.stopSession(m, sessionId, text);
}

/** Movies and series in the main server's library, with their TMDB/TVDB/IMDb ids. */
export function mainLibraryItems(ctx: jellyfin.JfCtx) {
  const m = mainExtra();
  if (!m) return jellyfin.libraryItems(ctx);
  return m.type === 'plex' ? plex.libraryItems(m) : jellyfin.remoteLibraryItems(m);
}

/* --------------------------- every server's library --------------------------- */

export interface LibraryServer {
  id: string;
  type: MainType;
  name: string;
  /** The sign-in server. */
  main: boolean;
  /** Address people open, for "Open in …" links. */
  openUrl?: string;
  /** The server's own id (Plex machine id, Jellyfin/Emby server id), for deep links. */
  serverId?: string;
}

export interface LibraryEntry {
  id: string;
  name: string;
  type: 'Series' | 'Movie';
  year?: number;
  tvdb?: string;
  tmdb?: string;
  imdb?: string;
  /** When anyone last watched it, when the server says (Plex). */
  lastPlayed?: number;
  server: LibraryServer;
}

/**
 * Movies and series on every media server: the main one and each extra
 * Jellyfin, Emby and Plex server. A server that can't be read is left out and
 * named in `failed`, so one being down never hides the others.
 */
export async function allLibraryItems(ctx: jellyfin.JfCtx) {
  const main = mainExtra();
  const servers: { server: LibraryServer; load: () => Promise<Omit<LibraryEntry, 'server'>[]> }[] = [];
  // Plex links need the server's machine id; servers added by address may not have it stored yet.
  const plexIds = new Map<string, string | undefined>();
  await Promise.all(
    mediaServers()
      .filter((s) => s.type === 'plex' && !s.serverId)
      .map(async (s) => plexIds.set(s.id, await cache.get(`plex:${s.id}:ident`, 60 * 60_000, () => plex.identity(s.url)))),
  );
  const describe = (s: MediaServer, isMain: boolean): LibraryServer => ({
    id: s.id,
    type: s.type,
    name: s.name,
    main: isMain,
    openUrl: s.publicUrl || s.url,
    serverId: s.serverId ?? plexIds.get(s.id),
  });
  if (main) servers.push({ server: describe(main, true), load: () => (main.type === 'plex' ? plex.libraryItems(main) : jellyfin.remoteLibraryItems(main)) });
  else if (isConfigured('jellyfin')) {
    const info = await jellyfin.publicInfo().catch(() => undefined);
    const settings = resolve('jellyfin').settings;
    servers.push({
      server: { id: 'jellyfin', type: 'jellyfin', name: info?.ServerName ?? 'Jellyfin', main: true, openUrl: settings.publicUrl || settings.url, serverId: info?.Id },
      load: () => jellyfin.libraryItems(ctx),
    });
  }
  for (const s of mediaServers()) {
    if (s.id === main?.id) continue;
    servers.push({ server: describe(s, false), load: () => (s.type === 'plex' ? plex.libraryItems(s) : jellyfin.remoteLibraryItems(s)) });
  }
  const results = await Promise.allSettled(servers.map((s) => s.load()));
  const items: LibraryEntry[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    const server = servers[i]!.server;
    if (r.status === 'fulfilled') for (const it of r.value) items.push({ ...it, server });
    else failed.push(server.name);
  });
  return { items, servers: servers.map((s) => s.server), failed };
}

/** Keys an item can be matched by across servers and the *arr apps. */
export function idKeys(i: { tmdb?: string | number; tvdb?: string | number; imdb?: string }) {
  return [i.tmdb && `tmdb:${i.tmdb}`, i.tvdb && `tvdb:${i.tvdb}`, i.imdb && `imdb:${i.imdb}`].filter(Boolean) as string[];
}

/** A link that opens a title in the server's own web app, when the server's address is known. */
export function openLink(server: LibraryServer, itemId: string) {
  const base = server.openUrl?.replace(/\/+$/, '');
  if (!base || !/^https?:\/\//.test(base)) return undefined;
  if (server.type === 'plex') {
    const key = encodeURIComponent(`/library/metadata/${itemId}`);
    return server.serverId ? `${base}/web/index.html#!/server/${server.serverId}/details?key=${key}` : `${base}/web/index.html`;
  }
  if (server.type === 'emby') return `${base}/web/index.html#!/item?id=${encodeURIComponent(itemId)}${server.serverId ? `&serverId=${server.serverId}` : ''}`;
  return `${base}/web/#/details?id=${encodeURIComponent(itemId)}${server.serverId ? `&serverId=${server.serverId}` : ''}`;
}

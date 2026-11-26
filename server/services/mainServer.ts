import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { isConfigured, resolve } from '../settings.js';
import * as jellyfin from './jellyfin.js';
import { getStoredServer, setActiveServer, type MediaServer } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * The media server: the one StreamForge watches and people sign in with.
 *
 * Each install has exactly one, chosen at first-run setup and kept after
 * that: Jellyfin (the default), Plex or Emby. With Plex or Emby, people sign
 * in with their Plex or Emby account, and everything that reads the media
 * server (the dashboard, stats, your page, search, library health, alerts)
 * reads that server. A Plex or Emby server is stored in mediaServers.ts and
 * named here.
 */

export type MainType = 'jellyfin' | 'plex' | 'emby';

interface MainPref {
  type: MainType;
  /** The media server id of the main Plex or Emby server. */
  id?: string;
}

const PREF = 'mainServer';
let pref: MainPref = readPref<MainPref>(PREF, { type: 'jellyfin' });
setActiveServer(pref.type === 'jellyfin' ? undefined : pref.id);

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

/** Chooses Plex or Emby as the media server (first-run setup only). */
export function setMainServer(type: 'plex' | 'emby', id: string) {
  pref = { type, id };
  writePref(PREF, pref);
  setActiveServer(id);
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

/* ------------------------------ the library ------------------------------ */

export interface LibraryServer {
  id: string;
  type: MainType;
  name: string;
  /** Always true now that an install has one media server; kept for callers. */
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

/** The media server, described for links and labels. */
export async function libraryServer(): Promise<LibraryServer | undefined> {
  const m = mainExtra();
  if (m) {
    // Plex links need the server's machine id; servers added by address may not have it stored yet.
    const serverId = m.serverId ?? (m.type === 'plex' ? await cache.get(`plex:${m.id}:ident`, 60 * 60_000, () => plex.identity(m.url)).catch(() => undefined) : undefined);
    return { id: m.id, type: m.type, name: m.name, main: true, openUrl: m.publicUrl || m.url, serverId };
  }
  if (!isConfigured('jellyfin')) return undefined;
  const info = await jellyfin.publicInfo().catch(() => undefined);
  const settings = resolve('jellyfin').settings;
  return { id: 'jellyfin', type: 'jellyfin', name: info?.ServerName ?? 'Jellyfin', main: true, openUrl: settings.publicUrl || settings.url, serverId: info?.Id };
}

/**
 * Movies and series in the media server's library, each tagged with the
 * server. `failed` names the server when it couldn't be read.
 */
export async function allLibraryItems(ctx: jellyfin.JfCtx) {
  const server = await libraryServer();
  if (!server) return { items: [] as LibraryEntry[], servers: [] as LibraryServer[], failed: [] as string[] };
  try {
    const list = await mainLibraryItems(ctx);
    return { items: list.map((it): LibraryEntry => ({ ...it, server })), servers: [server], failed: [] as string[] };
  } catch {
    return { items: [] as LibraryEntry[], servers: [server], failed: [server.name] };
  }
}

/** Keys an item can be matched by against the *arr apps and Seerr. */
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

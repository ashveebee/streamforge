import { readPref, writePref } from '../lib/db.js';
import { isConfigured } from '../settings.js';
import * as jellyfin from './jellyfin.js';
import { getStoredServer, type MediaServer } from './mediaServers.js';
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

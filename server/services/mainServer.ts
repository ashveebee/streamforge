import { readPref, writePref } from '../lib/db.js';
import { isConfigured } from '../settings.js';
import * as jellyfin from './jellyfin.js';
import { getStoredServer, type MediaServer } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * The main media server: the one people sign in with.
 *
 * It's Jellyfin by default. A household that only runs Plex can make a Plex
 * server the main one instead: people then sign in with their Plex account,
 * and everything that used to read the main Jellyfin server (the dashboard,
 * stats, your page, search, library health, alerts) reads that Plex server.
 *
 * The main Plex server is stored with the other media servers (so it gets
 * health checks, Now Playing and its page like any other) and named here.
 */

export type MainType = 'jellyfin' | 'plex';

interface MainPref {
  type: MainType;
  /** The media server id of the main Plex server. */
  id?: string;
}

const PREF = 'mainServer';
let pref: MainPref = readPref<MainPref>(PREF, { type: 'jellyfin' });

/** The main Plex server, when Plex is the sign-in server. */
export function mainPlex(): MediaServer | undefined {
  if (pref.type !== 'plex' || !pref.id) return undefined;
  const s = getStoredServer(pref.id);
  return s?.type === 'plex' ? s : undefined;
}

/** True when people sign in with Plex. */
export const plexMode = () => !!mainPlex();

/** Which kind of server people sign in with. */
export const mainType = (): MainType => (plexMode() ? 'plex' : 'jellyfin');

/** True once a main server is set up (either kind). */
export const mediaReady = () => plexMode() || isConfigured('jellyfin');

export function setMainPlex(id: string) {
  pref = { type: 'plex', id };
  writePref(PREF, pref);
}

export function clearMainServer() {
  pref = { type: 'jellyfin' };
  writePref(PREF, pref);
}

export const isMainServer = (id: string) => pref.type === 'plex' && pref.id === id;

/** Active streams on the main server, for background features (recorder, alerts, rules). */
export async function mainNowPlaying(): Promise<jellyfin.NowPlaying[] | undefined> {
  const p = mainPlex();
  if (p) return plex.nowPlaying(p);
  return jellyfin.serverNowPlaying();
}

/** Whether background features can read the main server without a signed-in user. */
export const canWatchInBackground = () => plexMode() || jellyfin.hasServerKey();

/** Stops (or, on Jellyfin, messages) a stream on the main server from a background feature. */
export async function controlMainSession(sessionId: string, command: jellyfin.SessionCommand, text?: string) {
  const p = mainPlex();
  if (!p) return jellyfin.controlSessionAsServer(sessionId, command, text);
  // Plex can only end a stream; the message becomes the reason shown to the viewer.
  if (command === 'stop') return plex.stopSession(p, sessionId, text);
}

/** Movies and series in the main server's library, with their TMDB/TVDB/IMDb ids. */
export function mainLibraryItems(ctx: jellyfin.JfCtx) {
  const p = mainPlex();
  return p ? plex.libraryItems(p) : jellyfin.libraryItems(ctx);
}

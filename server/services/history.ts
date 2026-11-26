import { cache } from '../lib/cache.js';
import { db } from '../lib/db.js';
import { jf, remotePlaybackEntries, serverToken, type JfCtx, type JfServerTarget } from './jellyfin.js';
import { allLibraryItems, mainEmby, mainExtra, mainPlex, type LibraryEntry, type LibraryServer } from './mainServer.js';
import * as plex from './plex.js';
import { mediaServers } from './mediaServers.js';
import { parsePlaybackName, splitSeries } from './playStats.js';

/*
 * Watch history for every user, for admins.
 *
 * Two sources are merged:
 *  - StreamForge's own play recorder (every media server, from the day
 *    StreamForge started recording): client, device, how it played and how
 *    long was watched.
 *  - The main server's own record, which goes back further: Jellyfin's
 *    per-user "last played" date for each finished movie and episode, or
 *    Plex's watch history. These have no device or duration, and only fill in
 *    the time before StreamForge's first recorded play for that user, so
 *    nothing shows twice.
 */

export const HISTORY_DAYS = [7, 30, 90, 365, 0] as const;
const MIN_WATCHED = 60_000;
const MAX_ROWS = 500;

export interface HistoryRow {
  id: string;
  user: string;
  at: string;
  title: string;
  subtitle?: string;
  type: 'movie' | 'episode' | 'other';
  client?: string;
  device?: string;
  /** Which media server it was played on. */
  serverId?: string;
  serverType?: 'jellyfin' | 'plex' | 'emby';
  serverName?: string;
  /** The movie or series poster, served through StreamForge's image proxy. */
  poster?: { itemId: string; server?: string };
  /** StreamForge's page for the title, when it can be found. */
  link?: string;
  method?: string;
  watchedMs?: number;
  /** Where the row came from: StreamForge's recorder, or the server's own history. */
  source: 'recorded' | 'server';
}

interface PlayRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  title: string;
  series: string | null;
  type: string | null;
  client: string | null;
  device: string | null;
  method: string;
  started_at: number;
  watched_ms: number;
  server: string | null;
  server_name: string | null;
  item_id: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();

function recorded(since: number) {
  return db
    .prepare(`SELECT id, user_id, user_name, item_id, title, series, type, client, device, method, started_at, watched_ms, server, server_name FROM plays WHERE started_at >= ? AND watched_ms >= ? AND user_name IS NOT NULL ORDER BY started_at DESC`)
    .all(since, MIN_WATCHED) as unknown as PlayRow[];
}

/** Each user's first recorded play, so the server's older history can fill in before it. */
function firstRecorded() {
  const rows = db.prepare('SELECT lower(user_name) AS u, MIN(started_at) AS t FROM plays WHERE user_name IS NOT NULL GROUP BY lower(user_name)').all() as { u: string; t: number }[];
  return new Map(rows.map((r) => [r.u, r.t]));
}

interface JfUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  Policy?: { IsDisabled?: boolean };
  LastActivityDate?: string;
}
interface JfPlayedItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesName?: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  UserData?: { LastPlayedDate?: string };
}

const code = (s?: number, e?: number) => (s !== undefined || e !== undefined ? `S${String(s ?? 0).padStart(2, '0')}E${String(e ?? 0).padStart(2, '0')}` : undefined);

/** Jellyfin users (main server only) and what each has finished, newest first. */
async function jellyfinHistory(ctx: JfCtx) {
  return cache.get('history:jf', 10 * 60_000, async () => {
    const token = serverToken(ctx);
    const users = (await jf<JfUser[]>('/Users', token, ctx.deviceId)).filter((u) => !u.Policy?.IsDisabled);
    const rows = await Promise.all(
      users.map(async (u) => {
        const res = await jf<{ Items: JfPlayedItem[] }>('/Items', token, ctx.deviceId, {
          userId: u.Id,
          Recursive: true,
          IncludeItemTypes: 'Movie,Episode',
          Filters: 'IsPlayed',
          SortBy: 'DatePlayed',
          SortOrder: 'Descending',
          Limit: 1000,
          EnableImages: false,
          EnableTotalRecordCount: false,
        }).catch(() => ({ Items: [] as JfPlayedItem[] }));
        return res.Items.filter((i) => i.UserData?.LastPlayedDate).map(
          (i): HistoryRow => ({
            id: `jf:${u.Id}:${i.Id}`,
            user: u.Name,
            at: new Date(i.UserData!.LastPlayedDate!).toISOString(),
            title: i.Type === 'Episode' ? (i.SeriesName ?? i.Name) : i.Name,
            subtitle: i.Type === 'Episode' ? [code(i.ParentIndexNumber, i.IndexNumber), i.Name].filter(Boolean).join(' · ') : undefined,
            type: i.Type === 'Episode' ? 'episode' : 'movie',
            serverId: 'jellyfin',
            poster: { itemId: i.Type === 'Episode' ? (i.SeriesId ?? i.Id) : i.Id },
            source: 'server',
          }),
        );
      }),
    );
    return { users, rows: rows.flat() };
  });
}

/** A Plex server's own watch history. */
async function plexHistory(srv: JfServerTarget, since: number) {
  const plays = await plex.playsSince(srv, since).catch(() => []);
  return plays.map((x, n): HistoryRow => {
    const ep = x.group !== x.title ? x.title.slice(x.group.length).replace(/^\s*-\s*/, '').replace(/\s-\s/, ' · ') : undefined;
    return { id: `plex:${srv.id}:${x.userId ?? x.user}:${x.at}:${n}`, user: x.user, at: new Date(x.at).toISOString(), title: x.group, subtitle: ep || undefined, type: ep ? 'episode' : 'movie', serverId: srv.id, source: 'server' };
  });
}

/** A Jellyfin or Emby server's activity log ("Alex is playing Show - S01E02 - Pilot on TV"). */
async function activityHistory(srv: JfServerTarget, since: number) {
  const entries = await remotePlaybackEntries(srv, new Date(since)).catch(() => []);
  return entries.flatMap((e, n): HistoryRow[] => {
    const p = parsePlaybackName(e.name);
    if (!p) return [];
    const ep = p.group !== p.title ? p.title.slice(p.group.length).replace(/^\s*-\s*/, '').replace(/\s-\s/, ' · ') : undefined;
    return [{ id: `log:${srv.id}:${e.date}:${n}`, user: p.user, at: new Date(e.date).toISOString(), title: p.group, subtitle: ep || undefined, type: ep ? 'episode' : 'movie', client: p.client, serverId: srv.id, source: 'server' }];
  });
}

/** Every extra server's own history, so it isn't limited to whichever server was added first. */
async function extraHistory(since: number) {
  const main = mainExtra();
  const rows = await Promise.all(mediaServers().filter((x) => x.id !== main?.id).map((x) => (x.type === 'plex' ? plexHistory(x, since) : activityHistory(x, since))));
  return rows.flat();
}

function fromPlay(r: PlayRow): HistoryRow {
  const t = (r.type ?? '').toLowerCase();
  // Episodes are stored as "Series · Episode"; the series is shown as the title already.
  const ep = r.series && r.title.startsWith(`${r.series} · `) ? r.title.slice(r.series.length + 3) : r.title;
  return {
    id: r.id,
    user: r.user_name!,
    at: new Date(r.started_at).toISOString(),
    title: r.series ?? r.title,
    subtitle: r.series ? ep : undefined,
    type: t === 'episode' ? 'episode' : t === 'movie' ? 'movie' : r.series ? 'episode' : 'other',
    client: r.client ?? undefined,
    device: r.device ?? undefined,
    // Plays on the main server carry no server id.
    serverId: r.server ?? mainExtra()?.id ?? 'jellyfin',
    serverName: r.server_name ?? undefined,
    method: r.method,
    watchedMs: r.watched_ms,
    source: 'recorded',
    ...(r.item_id && t === 'movie' ? { poster: { itemId: r.item_id } } : {}),
  };
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every server's movies and series by name, to find posters, links and server names. */
async function libraryIndex(ctx: JfCtx) {
  return cache.get('history:library', 10 * 60_000, async () => {
    const lib = await allLibraryItems(ctx);
    const byServer = new Map<string, LibraryEntry>();
    const anywhere = new Map<string, LibraryEntry>();
    for (const i of lib.items) {
      byServer.set(`${i.server.id}|${key(i.name)}`, i);
      const cur = anywhere.get(key(i.name));
      // Prefer a copy with a TMDb id (it gets a full title page), then the main server's.
      if (!cur || (!cur.tmdb && i.tmdb) || (!!cur.tmdb === !!i.tmdb && i.server.main && !cur.server.main)) anywhere.set(key(i.name), i);
    }
    return { byServer, anywhere, servers: lib.servers };
  });
}

/** StreamForge's title page for a library entry: by TMDb id, or the main Jellyfin server's own item page. */
const entryLink = (e: LibraryEntry) => (e.tmdb ? `/media/${e.type === 'Series' ? 'tv' : 'movie'}/${e.tmdb}` : e.server.id === 'jellyfin' && e.server.main ? `/media/jellyfin/${e.id}` : undefined);

/** Finds title pages by name, for lists like the Stats page's most watched. */
export async function titleLinks(ctx: JfCtx) {
  const idx = await libraryIndex(ctx).catch(() => undefined);
  return (name: string) => {
    const e = idx?.anywhere.get(key(name));
    return e ? entryLink(e) : undefined;
  };
}

/** The image proxy wants no server id for the main Jellyfin server. */
const imageServer = (s: LibraryServer | undefined, id: string) => (id === 'jellyfin' && (!s || s.main) ? undefined : id);

export async function watchHistory(ctx: JfCtx, opts: { days: number; user?: string; q?: string; server?: string }) {
  const since = opts.days ? Date.now() - opts.days * 86_400_000 : 0;
  const plays = recorded(since).map(fromPlay);
  const first = firstRecorded();
  const p = mainPlex();
  const e = mainEmby();
  const jfMain = !p && !e;
  const [jfData, mainRows, extraRows] = await Promise.all([
    jfMain ? jellyfinHistory(ctx).catch(() => undefined) : undefined,
    p ? plexHistory(p, since) : e ? activityHistory(e, since) : [],
    extraHistory(since),
  ]);
  const serverRows = [...(jfData?.rows ?? mainRows), ...extraRows];
  // Only the server's history from before StreamForge recorded that user, so nothing is listed twice.
  const older = serverRows.filter((r) => Date.parse(r.at) >= since && Date.parse(r.at) < (first.get(norm(r.user)) ?? Infinity));
  const merged = [...plays, ...older].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // Name each row's server and find its poster on that server (series poster for episodes).
  const idx = await libraryIndex(ctx).catch(() => undefined);
  const servers = new Map((idx?.servers ?? []).map((x) => [x.id, x]));
  const seen = new Map<string, { id: string; name: string; type: 'jellyfin' | 'plex' | 'emby'; plays: number }>();
  for (const r of merged) {
    // "Show - Episode" from an activity log without S01E02: split it when the show is in a library.
    if (r.source === 'server' && !r.subtitle && r.title.includes(' - ')) {
      const split = splitSeries(r.title, (n) => idx?.anywhere.get(key(n))?.type === 'Series');
      if (split) Object.assign(r, { title: split.series, subtitle: split.episode, type: 'episode' });
    }
    const srv = r.serverId ? servers.get(r.serverId) : undefined;
    if (srv) {
      r.serverType = srv.type;
      r.serverName = srv.name;
    }
    const k = key(r.title);
    const onServer = r.serverId ? idx?.byServer.get(`${r.serverId}|${k}`) : undefined;
    const elsewhere = idx?.anywhere.get(k);
    if (onServer) r.poster = { itemId: onServer.id, server: imageServer(srv, r.serverId!) };
    else if (r.poster && r.serverId) r.poster = { itemId: r.poster.itemId, server: imageServer(srv, r.serverId) };
    else if (elsewhere) r.poster = { itemId: elsewhere.id, server: imageServer(elsewhere.server, elsewhere.server.id) };
    // Link to the title page; a copy elsewhere may know the TMDb id when this server's doesn't.
    r.link = (onServer && entryLink(onServer)) || (elsewhere && entryLink(elsewhere)) || (r.serverId === 'jellyfin' && r.poster && !r.poster.server ? `/media/jellyfin/${r.poster.itemId}` : undefined);
    if (r.serverId && r.serverType) {
      const v = seen.get(r.serverId) ?? { id: r.serverId, name: r.serverName ?? r.serverId, type: r.serverType, plays: 0 };
      v.plays++;
      seen.set(r.serverId, v);
    }
  }
  const all = opts.server ? merged.filter((r) => r.serverId === opts.server) : merged;

  // People: everyone with history in the range, plus every Jellyfin user (even with none).
  const people = new Map<string, { name: string; plays: number; watchedMs: number; lastAt?: string; id?: string; imageTag?: string }>();
  const person = (name: string) => {
    const k = norm(name);
    let v = people.get(k);
    if (!v) people.set(k, (v = { name, plays: 0, watchedMs: 0 }));
    return v;
  };
  for (const u of jfData?.users ?? []) Object.assign(person(u.Name), { id: u.Id, imageTag: u.PrimaryImageTag });
  for (const r of all) {
    const v = person(r.user);
    v.plays++;
    v.watchedMs += r.watchedMs ?? 0;
    if (!v.lastAt || r.at > v.lastAt) v.lastAt = r.at;
  }

  const q = opts.q ? norm(opts.q) : '';
  const rows = all.filter((r) => (!opts.user || norm(r.user) === norm(opts.user)) && (!q || norm(`${r.title} ${r.subtitle ?? ''}`).includes(q)));

  // A summary of whatever is selected.
  const top = new Map<string, { title: string; plays: number; type: HistoryRow['type']; link?: string }>();
  const devices = new Map<string, number>();
  for (const r of rows) {
    const t = top.get(r.title) ?? { title: r.title, plays: 0, type: r.type, link: r.link };
    t.plays++;
    top.set(r.title, t);
    const d = [r.client, r.device].filter(Boolean).join(' · ');
    if (d) devices.set(d, (devices.get(d) ?? 0) + 1);
  }
  const transcodes = rows.filter((r) => r.method === 'Transcode').length;
  const recordedRows = rows.filter((r) => r.source === 'recorded').length;

  return {
    days: opts.days,
    /** Servers with plays in this range, for the server filter. */
    servers: [...seen.values()].sort((a, b) => b.plays - a.plays),
    users: [...people.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '') || a.name.localeCompare(b.name)),
    summary: {
      plays: rows.length,
      watchedMs: rows.reduce((n, r) => n + (r.watchedMs ?? 0), 0),
      titles: top.size,
      movies: rows.filter((r) => r.type === 'movie').length,
      episodes: rows.filter((r) => r.type === 'episode').length,
      transcodePct: recordedRows ? Math.round((transcodes / recordedRows) * 100) : undefined,
      top: [...top.values()].sort((a, b) => b.plays - a.plays).slice(0, 5),
      device: [...devices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    },
    rows: rows.slice(0, MAX_ROWS),
    total: rows.length,
    /** When the recorder's history starts; older rows come from the server's own record. */
    recordingSince: (db.prepare('SELECT MIN(started_at) AS t FROM plays').get() as { t: number | null }).t ?? undefined,
    serverHistory: jfData ? 'jellyfin' : p ? 'plex' : undefined,
  };
}

/**
 * Who has watched one title, across every server: each person's latest play
 * (where, on what, how much) and how many plays each server has had.
 */
export async function titleWatchers(ctx: JfCtx, title: string) {
  const h = await watchHistory(ctx, { days: 0, q: title });
  const rows = h.rows.filter((r) => key(r.title) === key(title));
  const people = new Map<string, HistoryRow & { plays: number }>();
  const perServer = new Map<string, number>();
  for (const r of rows) {
    if (r.serverId) perServer.set(r.serverId, (perServer.get(r.serverId) ?? 0) + 1);
    const p = people.get(norm(r.user));
    if (p) p.plays++;
    else people.set(norm(r.user), { ...r, plays: 1 });
  }
  return {
    people: [...people.values()].map((r) => ({
      user: r.user,
      at: r.at,
      plays: r.plays,
      serverId: r.serverId,
      serverName: r.serverName,
      serverType: r.serverType,
      client: r.client,
      device: r.device,
      watchedMs: r.watchedMs,
      source: r.source,
    })),
    perServer: Object.fromEntries(perServer),
  };
}

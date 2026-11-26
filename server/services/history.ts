import { cache } from '../lib/cache.js';
import { db } from '../lib/db.js';
import { jf, serverToken, type JfCtx } from './jellyfin.js';
import { mainEmby, mainPlex } from './mainServer.js';
import * as plex from './plex.js';

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
  server?: string;
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
  server_name: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();

function recorded(since: number) {
  return db
    .prepare(`SELECT id, user_id, user_name, title, series, type, client, device, method, started_at, watched_ms, server_name FROM plays WHERE started_at >= ? AND watched_ms >= ? AND user_name IS NOT NULL ORDER BY started_at DESC`)
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
            source: 'server',
          }),
        );
      }),
    );
    return { users, rows: rows.flat() };
  });
}

/** Plex's own watch history (main Plex server only). */
async function plexHistory(since: number) {
  const p = mainPlex();
  if (!p) return [];
  const plays = await plex.playsSince(p, since).catch(() => []);
  return plays.map((x, n): HistoryRow => {
    const ep = x.group !== x.title ? x.title.slice(x.group.length).replace(/^\s*-\s*/, '').replace(/\s-\s/, ' · ') : undefined;
    return { id: `plex:${x.userId ?? x.user}:${x.at}:${n}`, user: x.user, at: new Date(x.at).toISOString(), title: x.group, subtitle: ep || undefined, type: ep ? 'episode' : 'movie', source: 'server' };
  });
}

function fromPlay(r: PlayRow): HistoryRow {
  const t = (r.type ?? '').toLowerCase();
  return {
    id: r.id,
    user: r.user_name!,
    at: new Date(r.started_at).toISOString(),
    title: r.series ?? r.title,
    subtitle: r.series ? r.title : undefined,
    type: t === 'episode' ? 'episode' : t === 'movie' ? 'movie' : r.series ? 'episode' : 'other',
    client: r.client ?? undefined,
    device: r.device ?? undefined,
    server: r.server_name ?? undefined,
    method: r.method,
    watchedMs: r.watched_ms,
    source: 'recorded',
  };
}

export async function watchHistory(ctx: JfCtx, opts: { days: number; user?: string; q?: string }) {
  const since = opts.days ? Date.now() - opts.days * 86_400_000 : 0;
  const plays = recorded(since).map(fromPlay);
  const first = firstRecorded();
  const p = mainPlex();
  const jfMain = !p && !mainEmby();
  const jfData = jfMain ? await jellyfinHistory(ctx).catch(() => undefined) : undefined;
  const serverRows = jfData ? jfData.rows : await plexHistory(since);
  // Only the server's history from before StreamForge recorded that user, so nothing is listed twice.
  const older = serverRows.filter((r) => Date.parse(r.at) >= since && Date.parse(r.at) < (first.get(norm(r.user)) ?? Infinity));
  const all = [...plays, ...older].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

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
  const top = new Map<string, { title: string; plays: number; type: HistoryRow['type'] }>();
  const devices = new Map<string, number>();
  for (const r of rows) {
    const t = top.get(r.title) ?? { title: r.title, plays: 0, type: r.type };
    t.plays++;
    top.set(r.title, t);
    const d = [r.client, r.device].filter(Boolean).join(' · ');
    if (d) devices.set(d, (devices.get(d) ?? 0) + 1);
  }
  const transcodes = rows.filter((r) => r.method === 'Transcode').length;
  const recordedRows = rows.filter((r) => r.source === 'recorded').length;

  return {
    days: opts.days,
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

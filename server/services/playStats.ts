import { db } from '../lib/db.js';
import { isConfigured } from '../settings.js';
import type { JfCtx } from './jellyfin.js';
import * as jellyfin from './jellyfin.js';
import { canWatchInBackground, mainEmby, mainExtra, mainNowPlaying, mainPlex } from './mainServer.js';
import { titleLinks } from './history.js';
import { mediaServers } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * Playback statistics.
 *
 * A recorder samples active sessions on every media server (the main one
 * needs a Jellyfin API key when it's Jellyfin) every 30 seconds and stores one row per play: who, what, on which client, how it
 * was delivered (the "worst" method seen, so a play that ever transcoded
 * counts as a transcode) and how long it was actually watched.
 *
 * Without a key — or for periods before recording started — stats fall back
 * to Jellyfin's activity log, which has plays per user and title but no
 * watch time or transcode information.
 */

const SAMPLE_MS = 30_000;
const RANK: Record<string, number> = { DirectPlay: 0, DirectStream: 1, Transcode: 2 };

interface Active {
  rowId: string;
  itemId: string;
  method: string;
  lastSeen: number;
}
const active = new Map<string, Active>();

const insert = db.prepare(
  `INSERT INTO plays (id, user_id, user_name, item_id, title, series, type, client, device, method, started_at, last_seen, watched_ms, server, server_name)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
);
const touch = db.prepare('UPDATE plays SET last_seen = ?, watched_ms = watched_ms + ?, method = ? WHERE id = ?');

/**
 * Streams on every media server: the main one, plus each extra Jellyfin, Emby
 * and Plex server. A server that's down is skipped; the rest still count.
 */
async function everyStream() {
  const main = mainExtra();
  const extras = mediaServers().filter((s) => s.id !== main?.id);
  const lists = await Promise.all([
    mainNowPlaying().catch(() => undefined),
    ...extras.map((srv) => (srv.type === 'plex' ? plex.nowPlaying(srv) : jellyfin.remoteNowPlaying(srv)).catch(() => undefined)),
  ]);
  if (lists.every((l) => l === undefined)) return undefined;
  return lists.flatMap((l) => l ?? []);
}

export async function recordSample() {
  const streams = await everyStream();
  if (!streams) return;
  const now = Date.now();
  const seen = new Set<string>();
  for (const s of streams) {
    // Session ids are only unique within one server.
    const key = `${s.server ?? 'main'}:${s.sessionId}`;
    seen.add(key);
    const cur = active.get(key);
    const method = s.state.playMethod;
    if (!cur || cur.itemId !== s.item.id) {
      const rowId = `${key}:${s.item.id}:${now}`;
      insert.run(
        rowId,
        s.user.id ?? null,
        s.user.name,
        s.item.id,
        s.item.seriesName ? `${s.item.seriesName} · ${s.item.title}` : s.item.title,
        s.item.seriesName ?? null,
        s.item.type ?? null,
        s.client ?? null,
        s.device ?? null,
        method,
        now,
        now,
        s.server ?? null,
        s.serverName ?? null,
      );
      active.set(key, { rowId, itemId: s.item.id, method, lastSeen: now });
      continue;
    }
    // Count time only while playing, and never more than one interval (gaps = server was busy/asleep).
    const watched = s.state.isPaused ? 0 : Math.min(now - cur.lastSeen, SAMPLE_MS * 2);
    if ((RANK[method] ?? 0) > (RANK[cur.method] ?? 0)) cur.method = method;
    cur.lastSeen = now;
    touch.run(now, watched, cur.method, cur.rowId);
  }
  for (const id of active.keys()) if (!seen.has(id)) active.delete(id);
}

export function startPlaybackRecorder() {
  setInterval(() => void recordSample(), SAMPLE_MS).unref();
  void recordSample();
}

/* --------------------------------- stats --------------------------------- */

interface Play {
  /** The media server it was played on. */
  server: string;
  user: string;
  title: string;
  group: string;
  client?: string;
  method?: string;
  at: number;
  watchedMs?: number;
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** "Alex is playing Some Show - S01E02 - Pilot on Living Room TV" → parts. */
export function parsePlaybackName(name: string) {
  const m = name.match(/^(.+?) (?:is playing|has finished playing|is watching) (.+?) on (.+)$/);
  if (!m) return undefined;
  const title = m[2]!.trim();
  const series = title.match(/^(.+?) - S\d+E\d+/i)?.[1];
  return { user: m[1]!.trim(), title, group: series ?? title, client: m[3]!.trim() };
}

/** The main server's id, as plays and the server filter use it. */
const mainId = () => mainExtra()?.id ?? 'jellyfin';

/** Every media server StreamForge knows, main one first. */
async function allServers() {
  const main = mainExtra();
  const list: { id: string; name: string; type: 'jellyfin' | 'plex' | 'emby' }[] = [];
  if (!main && isConfigured('jellyfin')) list.push({ id: 'jellyfin', name: (await jellyfin.publicInfo().catch(() => undefined))?.ServerName ?? 'Jellyfin', type: 'jellyfin' });
  if (main) list.push({ id: main.id, name: main.name, type: main.type });
  for (const s of mediaServers()) if (s.id !== main?.id) list.push({ id: s.id, name: s.name, type: s.type });
  return list;
}

function fromRecorder(since: number): Play[] {
  const rows = db
    .prepare('SELECT user_name, title, series, client, method, started_at, watched_ms, server FROM plays WHERE started_at >= ? ORDER BY started_at')
    .all(since) as { user_name: string; title: string; series: string | null; client: string | null; method: string; started_at: number; watched_ms: number; server: string | null }[];
  const main = mainId();
  // Very short plays are usually someone browsing or a false start.
  return rows
    .filter((r) => r.watched_ms >= 60_000)
    // Plays on the main server carry no server id.
    .map((r) => ({ server: r.server ?? main, user: r.user_name, title: r.title, group: r.series ?? r.title, client: r.client ?? undefined, method: r.method, at: r.started_at, watchedMs: r.watched_ms }));
}

async function fromActivity(ctx: JfCtx, since: number): Promise<Play[]> {
  // Plex: its watch history has who played what and when, like Jellyfin's activity log.
  const p = mainPlex();
  if (p) return (await plex.playsSince(p, since)).map((x) => ({ server: p.id, user: x.user, title: x.title, group: x.group, at: x.at }));
  const emby = mainEmby();
  const entries = emby ? await jellyfin.remotePlaybackEntries(emby, new Date(since)) : await jellyfin.playbackEntries(ctx, new Date(since));
  const out: Play[] = [];
  for (const e of entries) {
    const p = parsePlaybackName(e.name);
    if (p) out.push({ ...p, server: mainId(), at: Date.parse(e.date) });
  }
  return out;
}

function top<K extends string>(plays: Play[], key: (p: Play) => K | undefined, n = 10) {
  const m = new Map<K, { name: K; plays: number; hours: number }>();
  for (const p of plays) {
    const k = key(p);
    if (!k) continue;
    const e = m.get(k) ?? { name: k, plays: 0, hours: 0 };
    e.plays++;
    e.hours += (p.watchedMs ?? 0) / 3_600_000;
    m.set(k, e);
  }
  return [...m.values()]
    .sort((a, b) => b.hours - a.hours || b.plays - a.plays)
    .slice(0, n)
    .map((e) => ({ ...e, hours: Math.round(e.hours * 10) / 10 }));
}

export async function playbackStats(ctx: JfCtx, days: number, server?: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.getTime() - (days - 1) * 86_400_000;
  const firstRecorded = (db.prepare('SELECT MIN(started_at) AS t FROM plays').get() as { t: number | null }).t;
  // Recorder data where it exists; the activity log for the time before it started.
  const recorded = fromRecorder(since);
  let plays = recorded;
  let source: 'recorder' | 'activity' | 'mixed' = 'recorder';
  if (!firstRecorded || firstRecorded > since) {
    const cutoff = firstRecorded ?? Infinity;
    const older = await fromActivity(ctx, since).catch(() => undefined);
    if (older) {
      plays = [...older.filter((p) => p.at < cutoff), ...recorded];
      source = recorded.length ? 'mixed' : 'activity';
    }
  }

  // With more than one server, the page can show one at a time.
  const known = await allServers();
  const servers = known.map((x) => ({ ...x, plays: plays.filter((p) => p.server === x.id).length }));
  const selected = server && known.some((x) => x.id === server) ? server : undefined;
  if (selected) plays = plays.filter((p) => p.server === selected);

  const byDay = new Map<string, { date: string; plays: number; direct: number; transcode: number; hours: number }>();
  for (let i = 0; i < days; i++) {
    const k = dayKey(since + i * 86_400_000 + 3_600_000);
    byDay.set(k, { date: k, plays: 0, direct: 0, transcode: 0, hours: 0 });
  }
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const p of plays) {
    const b = byDay.get(dayKey(p.at));
    if (b) {
      b.plays++;
      if (p.method === 'Transcode') b.transcode++;
      else if (p.method) b.direct++;
      b.hours += (p.watchedMs ?? 0) / 3_600_000;
    }
    const d = new Date(p.at);
    heat[(d.getDay() + 6) % 7]![d.getHours()]!++;
  }
  const withMethod = plays.filter((p) => p.method);
  const transcodes = withMethod.filter((p) => p.method === 'Transcode').length;
  const hours = plays.reduce((a, p) => a + (p.watchedMs ?? 0), 0) / 3_600_000;

  return {
    days,
    servers,
    server: selected,
    source,
    recording: canWatchInBackground() || mediaServers().length > 0,
    recordingSince: firstRecorded ? new Date(firstRecorded).toISOString() : undefined,
    totals: {
      plays: plays.length,
      hours: source === 'activity' ? undefined : Math.round(hours * 10) / 10,
      users: new Set(plays.map((p) => p.user)).size,
      transcodeShare: withMethod.length ? transcodes / withMethod.length : undefined,
    },
    daily: [...byDay.values()].map((d) => ({ ...d, hours: Math.round(d.hours * 10) / 10 })),
    heatmap: heat,
    topUsers: top(plays, (p) => p.user),
    topTitles: await (async () => {
      const link = await titleLinks(ctx);
      return top(plays, (p) => p.group).map((t) => ({ ...t, link: link(t.name) }));
    })(),
    topClients: top(plays, (p) => p.client, 6),
  };
}

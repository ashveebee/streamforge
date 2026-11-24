import { cache } from '../lib/cache.js';
import { db, readPref, writePref } from '../lib/db.js';
import { HttpError } from '../lib/handle.js';
import { coverUrl } from './arr.js';
import { arrInstance, arrInstances, type ArrInstance } from './instances.js';
import { jf, libraryItems, serverToken, type JfCtx } from './jellyfin.js';

/*
 * Cleanup suggestions: big movies and series that nobody has watched in a
 * long time, ranked by how much space removing them would free.
 *
 * "Watched" means any Jellyfin user has played (or started) it, according to
 * Jellyfin's per-user play data plus StreamForge's own play recorder. Items
 * added recently are never suggested, and admins can mark items to keep.
 */

export const UNWATCHED_DAYS = [90, 180, 365, 730] as const;

interface Image {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}
interface Movie {
  id: number;
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  hasFile: boolean;
  sizeOnDisk?: number;
  added?: string;
  monitored: boolean;
  images?: Image[];
}
interface Series {
  id: number;
  title: string;
  year?: number;
  tvdbId?: number;
  imdbId?: string;
  added?: string;
  status: string;
  monitored: boolean;
  images?: Image[];
  statistics?: { sizeOnDisk?: number; episodeFileCount?: number };
}

interface JfPlayed {
  Id: string;
  Type: string;
  SeriesId?: string;
  UserData?: { LastPlayedDate?: string; Played?: boolean };
}

/** Jellyfin item id (movie or series) → last time anyone played it. */
async function lastPlayed(ctx: JfCtx) {
  return cache.get('jf:lastplayed', 30 * 60_000, async () => {
    const token = serverToken(ctx);
    const users = await jf<{ Id: string; Policy?: { IsDisabled?: boolean } }[]>('/Users', token, ctx.deviceId);
    const last = new Map<string, number>();
    const bump = (id: string | undefined, at: string | number | undefined) => {
      if (!id || !at) return;
      const t = typeof at === 'number' ? at : Date.parse(at);
      if (t > (last.get(id) ?? 0)) last.set(id, t);
    };
    for (const u of users.filter((x) => !x.Policy?.IsDisabled)) {
      for (const filter of ['IsPlayed', 'IsResumable']) {
        const res = await jf<{ Items: JfPlayed[] }>('/Items', token, ctx.deviceId, {
          userId: u.Id,
          Recursive: true,
          IncludeItemTypes: 'Movie,Episode',
          Filters: filter,
          Fields: 'UserData',
          EnableImages: false,
          EnableTotalRecordCount: false,
        }).catch(() => ({ Items: [] as JfPlayed[] }));
        for (const i of res.Items) {
          const at = i.UserData?.LastPlayedDate;
          bump(i.Type === 'Episode' ? i.SeriesId : i.Id, at);
        }
      }
    }
    return last;
  });
}

/** Plays recorded by StreamForge, by title (movies) and series name. */
function recordedPlays() {
  const rows = db.prepare('SELECT title, series, MAX(last_seen) AS t FROM plays GROUP BY title, series').all() as { title: string; series: string | null; t: number }[];
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = (r.series ?? r.title).toLowerCase();
    if (r.t > (m.get(k) ?? 0)) m.set(k, r.t);
  }
  return m;
}

const KEEP = 'reclaimKeep';
const keepList = () => new Set(readPref<string[]>(KEEP, []));

export function keepItem(key: string, keep: boolean) {
  const s = keepList();
  if (keep) s.add(key);
  else s.delete(key);
  writePref(KEEP, [...s]);
  cache.delete('reclaim:');
}

export interface Suggestion {
  key: string;
  kind: 'movie' | 'series';
  instance: string;
  instanceName?: string;
  arrId: number;
  title: string;
  year?: number;
  size: number;
  added?: string;
  lastWatched?: string;
  poster?: string;
  ended?: boolean;
}

export async function reclaimSuggestions(ctx: JfCtx, days: number) {
  return cache.get(`reclaim:${days}`, 10 * 60_000, async () => {
    const cutoff = Date.now() - days * 86_400_000;
    const [jfItems, played] = await Promise.all([libraryItems(ctx), lastPlayed(ctx)]);
    const recorded = recordedPlays();
    const byTmdb = new Map<string, string>();
    const byTvdb = new Map<string, string>();
    const byImdb = new Map<string, string>();
    for (const i of jfItems) {
      if (i.tmdb) byTmdb.set(i.tmdb, i.id);
      if (i.tvdb) byTvdb.set(i.tvdb, i.id);
      if (i.imdb) byImdb.set(i.imdb, i.id);
    }
    const keep = keepList();
    const watchedAt = (jfId: string | undefined, title: string) => Math.max(jfId ? (played.get(jfId) ?? 0) : 0, recorded.get(title.toLowerCase()) ?? 0) || undefined;

    const out: Suggestion[] = [];
    let kept = 0;
    const consider = (s: Suggestion, addedAt?: string) => {
      if (!s.size) return;
      if (addedAt && Date.parse(addedAt) > cutoff) return;
      if (s.lastWatched && Date.parse(s.lastWatched) > cutoff) return;
      if (keep.has(s.key)) {
        kept++;
        return;
      }
      out.push(s);
    };

    await Promise.all(
      arrInstances().map(async (inst: ArrInstance) => {
        if (inst.kind === 'radarr') {
          const movies = await cache.get(`${inst.id}:movies`, 60_000, () => inst.client.get<Movie[]>('/api/v3/movie')).catch(() => [] as Movie[]);
          for (const m of movies) {
            if (!m.hasFile) continue;
            const jfId = (m.tmdbId && byTmdb.get(String(m.tmdbId))) || (m.imdbId && byImdb.get(m.imdbId)) || undefined;
            const t = watchedAt(jfId, m.title);
            consider(
              {
                key: `${inst.id}:movie:${m.id}`,
                kind: 'movie',
                instance: inst.id,
                instanceName: inst.primary ? undefined : inst.name,
                arrId: m.id,
                title: m.title,
                year: m.year,
                size: m.sizeOnDisk ?? 0,
                added: m.added,
                lastWatched: t ? new Date(t).toISOString() : undefined,
                poster: coverUrl(inst, m.images),
              },
              m.added,
            );
          }
        } else {
          const series = await cache.get(`${inst.id}:series`, 60_000, () => inst.client.get<Series[]>('/api/v3/series')).catch(() => [] as Series[]);
          for (const s of series) {
            const jfId = (s.tvdbId && byTvdb.get(String(s.tvdbId))) || (s.imdbId && byImdb.get(s.imdbId)) || undefined;
            const t = watchedAt(jfId, s.title);
            consider(
              {
                key: `${inst.id}:series:${s.id}`,
                kind: 'series',
                instance: inst.id,
                instanceName: inst.primary ? undefined : inst.name,
                arrId: s.id,
                title: s.title,
                year: s.year,
                size: s.statistics?.sizeOnDisk ?? 0,
                added: s.added,
                lastWatched: t ? new Date(t).toISOString() : undefined,
                poster: coverUrl(inst, s.images),
                ended: s.status === 'ended',
              },
              s.added,
            );
          }
        }
      }),
    );
    out.sort((a, b) => b.size - a.size);
    return {
      days,
      total: out.length,
      reclaimable: out.reduce((n, s) => n + s.size, 0),
      kept,
      items: out.slice(0, 100),
      checkedAt: new Date().toISOString(),
    };
  });
}

/** Removes a movie or series from its app; `deleteFiles` also deletes it from disk. */
export async function reclaim(kind: 'movie' | 'series', instanceId: string, id: number, action: 'delete' | 'unmonitor') {
  const inst = arrInstance(kind === 'movie' ? 'radarr' : 'sonarr', instanceId);
  if (!inst) throw new HttpError(404, 'Unknown instance', 'not_configured');
  const path = `/api/v3/${kind === 'movie' ? 'movie' : 'series'}/${id}`;
  const item = await inst.client.get<Record<string, unknown> & { title: string }>(path);
  if (action === 'delete') {
    await inst.client.del(path, { deleteFiles: true, addImportExclusion: false });
  } else {
    await inst.client.put(path, { ...item, monitored: false });
  }
  cache.delete(`${inst.id}:`);
  cache.delete('reclaim:');
  return { title: item.title, instance: inst.name };
}

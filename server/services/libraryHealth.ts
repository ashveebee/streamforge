import { cache } from '../lib/cache.js';
import { coverUrl } from './arr.js';
import { arrInstances, type ArrInstance } from './instances.js';
import type * as jellyfin from './jellyfin.js';
import { allLibraryItems, idKeys, mainName, mediaReady } from './mainServer.js';

/*
 * Library health: things that are quietly wrong across Sonarr, Radarr and
 * Jellyfin.
 *
 *  - incomplete series   monitored series with aired episodes still missing
 *  - upgrades available  files below the quality profile's cutoff
 *  - not in Jellyfin     downloaded in Sonarr/Radarr but Jellyfin doesn't
 *                        have it (wrong library path, failed scan, …)
 *  - not managed         in Jellyfin but in no Sonarr/Radarr instance, so it
 *                        won't get upgrades or new episodes
 *
 * Matching between the apps uses TVDB/TMDB/IMDb ids, never titles.
 */

interface Image {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}
interface Series {
  id: number;
  title: string;
  year?: number;
  status: string;
  monitored: boolean;
  tvdbId?: number;
  imdbId?: string;
  images?: Image[];
  statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; sizeOnDisk: number };
}
interface Movie {
  id: number;
  title: string;
  year?: number;
  monitored: boolean;
  hasFile: boolean;
  tmdbId?: number;
  imdbId?: string;
  images?: Image[];
  movieFile?: { qualityCutoffNotMet?: boolean; quality?: { quality?: { name?: string } } };
}

export interface HealthItem {
  title: string;
  year?: number;
  detail: string;
  instance?: string;
  instanceName?: string;
  poster?: string;
}

const LIMIT = 50;

async function cutoffCount(inst: ArrInstance, movies?: Movie[]) {
  try {
    const r = await cache.get(`${inst.id}:cutoff`, 5 * 60_000, () =>
      inst.client.get<{ totalRecords: number }>('/api/v3/wanted/cutoff', { pageSize: 1, monitored: true }),
    );
    return r.totalRecords;
  } catch {
    // Older Radarr has no wanted/cutoff endpoint; the movie list knows too.
    return movies?.filter((m) => m.monitored && m.movieFile?.qualityCutoffNotMet).length ?? 0;
  }
}

export async function libraryHealth(ctx: jellyfin.JfCtx) {
  const sonarrs = arrInstances('sonarr');
  const radarrs = arrInstances('radarr');
  const [seriesLists, movieLists, jf] = await Promise.all([
    Promise.all(sonarrs.map((i) => cache.get(`${i.id}:series`, 60_000, () => i.client.get<Series[]>('/api/v3/series')).then((list) => ({ i, list })))),
    Promise.all(radarrs.map((i) => cache.get(`${i.id}:movies`, 60_000, () => i.client.get<Movie[]>('/api/v3/movie')).then((list) => ({ i, list })))),
    mediaReady() ? allLibraryItems(ctx).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const tag = (i: ArrInstance) => ({ instance: i.id, instanceName: i.primary ? undefined : i.name });

  /* incomplete series */
  const incomplete: (HealthItem & { missing: number })[] = [];
  for (const { i, list } of seriesLists) {
    for (const s of list) {
      const st = s.statistics;
      if (!s.monitored || !st || st.episodeCount === 0) continue;
      const missing = st.episodeCount - st.episodeFileCount;
      if (missing <= 0) continue;
      incomplete.push({
        title: s.title,
        year: s.year,
        missing,
        detail: `${missing} of ${st.episodeCount} episode${st.episodeCount === 1 ? '' : 's'} missing${s.status === 'ended' ? ' · ended' : ''}`,
        poster: coverUrl(i, s.images),
        ...tag(i),
      });
    }
  }
  incomplete.sort((a, b) => b.missing - a.missing);

  /* upgrades */
  const upgrades = await Promise.all([
    ...seriesLists.map(async ({ i }) => ({ ...tag(i), kind: 'sonarr' as const, name: i.name, count: await cutoffCount(i) })),
    ...movieLists.map(async ({ i, list }) => ({ ...tag(i), kind: 'radarr' as const, name: i.name, count: await cutoffCount(i, list) })),
  ]);

  /* cross-checks with Jellyfin */
  let notInJellyfin: HealthItem[] | undefined;
  let unmanaged: HealthItem[] | undefined;
  // Compared with every media server: a download is only "missing" when no server has it.
  const lib = jf && jf.servers.length && jf.failed.length < jf.servers.length ? jf.items : undefined;
  const several = (jf?.servers.length ?? 0) > 1;
  if (lib) {
    const ids = new Set<string>();
    for (const j of lib) for (const k of idKeys(j)) ids.add(k);
    notInJellyfin = [];
    for (const { i, list } of seriesLists) {
      for (const s of list) {
        if (!s.statistics?.episodeFileCount) continue;
        if ((s.tvdbId && ids.has(`tvdb:${s.tvdbId}`)) || (s.imdbId && ids.has(`imdb:${s.imdbId}`))) continue;
        notInJellyfin.push({ title: s.title, year: s.year, detail: `${s.statistics.episodeFileCount} episode files in Sonarr`, poster: coverUrl(i, s.images), ...tag(i) });
      }
    }
    for (const { i, list } of movieLists) {
      for (const m of list) {
        if (!m.hasFile) continue;
        if ((m.tmdbId && ids.has(`tmdb:${m.tmdbId}`)) || (m.imdbId && ids.has(`imdb:${m.imdbId}`))) continue;
        notInJellyfin.push({ title: m.title, year: m.year, detail: 'Downloaded in Radarr', poster: coverUrl(i, m.images), ...tag(i) });
      }
    }

    const managed = new Set<string>();
    for (const { list } of seriesLists) for (const s of list) {
      if (s.tvdbId) managed.add(`tvdb:${s.tvdbId}`);
      if (s.imdbId) managed.add(`imdb:${s.imdbId}`);
    }
    for (const { list } of movieLists) for (const m of list) {
      if (m.tmdbId) managed.add(`tmdb:${m.tmdbId}`);
      if (m.imdbId) managed.add(`imdb:${m.imdbId}`);
    }
    unmanaged = [];
    // The same title on several servers is listed once, naming where it is.
    const seen = new Map<string, HealthItem & { where: string[] }>();
    for (const j of lib) {
      // Only compare against apps that exist: no Radarr means movies can't be "unmanaged".
      if (j.type === 'Series' ? !sonarrs.length : !radarrs.length) continue;
      const keys = idKeys(j);
      if (keys.some((k) => managed.has(k))) continue;
      const key = keys[0] ?? `${j.type}:${j.name.toLowerCase()}:${j.year ?? ''}`;
      const cur = seen.get(key);
      if (cur) {
        if (!cur.where.includes(j.server.name)) cur.where.push(j.server.name);
        continue;
      }
      const serverName = { jellyfin: 'Jellyfin', plex: 'Plex', emby: 'Emby', silo: 'Silo' }[j.server.type];
      seen.set(key, {
        title: j.name,
        year: j.year,
        detail: keys.length ? `${j.type === 'Series' ? 'Series' : 'Movie'} not in ${j.type === 'Series' ? 'Sonarr' : 'Radarr'}` : `No metadata ids — identify it in ${serverName}`,
        where: [j.server.name],
      });
    }
    for (const { where, ...item } of seen.values()) unmanaged.push(several ? { ...item, detail: `${item.detail} · on ${where.join(', ')}` } : item);
    unmanaged.sort((a, b) => a.title.localeCompare(b.title));
    notInJellyfin.sort((a, b) => a.title.localeCompare(b.title));
  }

  const section = <T,>(items: T[] | undefined) => (items ? { total: items.length, items: items.slice(0, LIMIT) } : undefined);
  return {
    checkedAt: new Date().toISOString(),
    hasSonarr: sonarrs.length > 0,
    hasRadarr: radarrs.length > 0,
    hasJellyfin: !!lib,
    /** What the library cross-checks compare with: one server's kind, or every media server. */
    server: several ? 'your media servers' : jf?.servers[0] ? { jellyfin: 'Jellyfin', plex: 'Plex', emby: 'Emby', silo: 'Silo' }[jf.servers[0].type] : mainName(),
    /** Servers that couldn't be read, so their titles weren't compared. */
    unreachable: jf?.failed.length ? jf.failed : undefined,
    incomplete: section(incomplete),
    upgrades,
    notInJellyfin: section(notInJellyfin),
    unmanaged: section(unmanaged),
  };
}

/** Searches for better releases of everything below cutoff. */
export async function searchUpgrades(inst: ArrInstance) {
  const name = inst.kind === 'sonarr' ? 'CutoffUnmetEpisodeSearch' : 'CutOffUnmetMoviesSearch';
  await inst.client.post('/api/v3/command', { name, monitored: true, filterKey: 'monitored', filterValue: 'true' });
  return { ok: true };
}

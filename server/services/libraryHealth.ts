import { cache } from '../lib/cache.js';
import { coverUrl } from './arr.js';
import { arrInstances, type ArrInstance } from './instances.js';
import type * as jellyfin from './jellyfin.js';
import { mainLibraryItems, mainName, mediaReady } from './mainServer.js';

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
    mediaReady() ? mainLibraryItems(ctx).catch(() => undefined) : Promise.resolve(undefined),
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
  if (jf) {
    const ids = new Set<string>();
    for (const j of jf) {
      if (j.tvdb) ids.add(`tvdb:${j.tvdb}`);
      if (j.tmdb) ids.add(`tmdb:${j.tmdb}`);
      if (j.imdb) ids.add(`imdb:${j.imdb}`);
    }
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
    for (const j of jf) {
      // Only compare against apps that exist: no Radarr means movies can't be "unmanaged".
      if (j.type === 'Series' ? !sonarrs.length : !radarrs.length) continue;
      const keys = [j.tvdb && `tvdb:${j.tvdb}`, j.tmdb && `tmdb:${j.tmdb}`, j.imdb && `imdb:${j.imdb}`].filter(Boolean) as string[];
      if (keys.some((k) => managed.has(k))) continue;
      unmanaged.push({
        title: j.name,
        year: j.year,
        detail: keys.length ? `${j.type === 'Series' ? 'Series' : 'Movie'} not in ${j.type === 'Series' ? 'Sonarr' : 'Radarr'}` : `No metadata ids — identify it in ${mainName()}`,
      });
    }
    unmanaged.sort((a, b) => a.title.localeCompare(b.title));
    notInJellyfin.sort((a, b) => a.title.localeCompare(b.title));
  }

  const section = <T,>(items: T[] | undefined) => (items ? { total: items.length, items: items.slice(0, LIMIT) } : undefined);
  return {
    checkedAt: new Date().toISOString(),
    hasSonarr: sonarrs.length > 0,
    hasRadarr: radarrs.length > 0,
    hasJellyfin: !!jf,
    /** Which server the library cross-checks compare with. */
    server: mainName(),
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

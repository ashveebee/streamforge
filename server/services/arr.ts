import { derived } from '../settings.js';
import { createClient, type ServiceClient } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import type { DiskInfo, HealthIssue, HealthProbe, QueueItem, UpcomingItem } from './types.js';
import type { ArrInstance } from './instances.js';

/* Shared bits for the *arr family (Sonarr, Radarr, Prowlarr). */

interface ArrStatus {
  version: string;
  appName?: string;
  instanceName?: string;
  startTime?: string;
  osName?: string;
  isDocker?: boolean;
  branch?: string;
}
interface ArrHealth {
  source: string;
  type: 'ok' | 'notice' | 'warning' | 'error';
  message: string;
  wikiUrl?: string;
}
interface ArrImage {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}

export function arrClient(name: string, url?: string, apiKey?: string) {
  return url && apiKey ? createClient(name, url, { 'X-Api-Key': apiKey }) : undefined;
}

export async function arrProbe(client: ServiceClient, apiVersion: 'v1' | 'v3'): Promise<HealthProbe> {
  const [status, health] = await Promise.all([
    client.get<ArrStatus>(`/api/${apiVersion}/system/status`),
    client.get<ArrHealth[]>(`/api/${apiVersion}/health`),
  ]);
  const issues: HealthIssue[] = health.map((h) => ({
    level: h.type === 'error' ? 'error' : h.type === 'warning' ? 'warning' : 'info',
    message: h.message,
    source: h.source,
    wikiUrl: h.wikiUrl,
  }));
  return {
    version: status.version,
    issues,
    meta: {
      instance: status.instanceName ?? status.appName,
      startTime: status.startTime,
      os: status.osName,
      docker: status.isDocker,
      branch: status.branch,
    },
  };
}

/**
 * Turns an *arr MediaCover URL into a URL on our own image proxy, so the
 * browser never needs to reach the service (or know its API key).
 */
export function coverUrl(inst: ArrInstance, images: ArrImage[] | undefined, type = 'poster') {
  const img = images?.find((i) => i.coverType === type);
  if (!img) return undefined;
  const match = img.url?.match(/\/MediaCover\/(\d+)\/([a-z]+(?:-\d+)?\.(?:jpg|png|webp))/i);
  if (match) return `/api/${inst.kind}/cover/${match[1]}/${match[2]}${inst.primary ? '' : `?instance=${encodeURIComponent(inst.id)}`}`;
  return img.remoteUrl;
}

export const COVER_FILE_RE = /^[a-z]+(?:-\d+)?\.(?:jpg|png|webp)$/i;

interface ArrDisk {
  path: string;
  label?: string;
  freeSpace: number;
  totalSpace: number;
}

export async function arrDisks(inst: ArrInstance): Promise<DiskInfo[]> {
  return cache.get(`${inst.id}:disks`, 60_000, async () => {
    const disks = await inst.client.get<ArrDisk[]>('/api/v3/diskspace');
    return disks
      .filter((d) => d.totalSpace > 0)
      .map((d) => ({ path: d.path, label: d.label, free: d.freeSpace, total: d.totalSpace }));
  });
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

interface ArrQueueRecord {
  id: number;
  title: string;
  status: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  protocol?: string;
  downloadClient?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  errorMessage?: string;
  statusMessages?: { title: string; messages: string[] }[];
  quality?: { quality?: { name?: string } };
  series?: { title: string; images?: ArrImage[] };
  episode?: { title: string; seasonNumber: number; episodeNumber: number };
  seasonNumber?: number;
  movie?: { title: string; year?: number; images?: ArrImage[] };
  downloadId?: string;
  added?: string;
}

export async function arrQueue(inst: ArrInstance): Promise<{ total: number; items: QueueItem[] }> {
  const { client, kind: source } = inst;
  return cache.get(`${inst.id}:queue`, 4_000, async () => {
    const query =
      source === 'sonarr'
        ? { pageSize: 100, includeSeries: true, includeEpisode: true }
        : { pageSize: 100, includeMovie: true };
    const res = await client.get<{ totalRecords: number; records: ArrQueueRecord[] }>('/api/v3/queue', query);
    return {
      total: res.totalRecords,
      items: res.records.map((r) => {
        const title =
          source === 'sonarr' ? (r.series?.title ?? r.title) : (r.movie?.title ?? r.title);
        const subtitle =
          source === 'sonarr' && r.episode
            ? `S${String(r.episode.seasonNumber).padStart(2, '0')}E${String(r.episode.episodeNumber).padStart(2, '0')} · ${r.episode.title}`
            : source === 'radarr' && r.movie?.year
              ? String(r.movie.year)
              : undefined;
        return {
          id: r.id,
          source,
          instance: inst.id,
          instanceName: inst.primary ? undefined : inst.name,
          downloadId: r.downloadId,
          added: r.added,
          title,
          subtitle,
          releaseTitle: r.title,
          status: r.status,
          trackedState: r.trackedDownloadState,
          trackedStatus: r.trackedDownloadStatus,
          protocol: r.protocol,
          client: r.downloadClient,
          quality: r.quality?.quality?.name,
          size: r.size,
          sizeLeft: r.sizeleft,
          progress: r.size > 0 ? Math.max(0, Math.min(1, 1 - r.sizeleft / r.size)) : 0,
          timeLeft: r.timeleft,
          estimatedCompletion: r.estimatedCompletionTime,
          errorMessage: r.errorMessage,
          warnings: (r.statusMessages ?? []).flatMap((m) => m.messages),
          poster: coverUrl(inst, source === 'sonarr' ? r.series?.images : r.movie?.images),
        };
      }),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Sonarr                                                              */
/* ------------------------------------------------------------------ */

export const sonarr = derived('sonarr', (s) => arrClient('sonarr', s.url, s.apiKey));

interface SonarrSeries {
  id: number;
  title: string;
  status: 'continuing' | 'ended' | 'upcoming' | 'deleted';
  monitored: boolean;
  network?: string;
  year?: number;
  images?: ArrImage[];
  added?: string;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

interface SonarrEpisode {
  id: number;
  seriesId: number;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  airDateUtc?: string;
  hasFile: boolean;
  monitored: boolean;
  series?: SonarrSeries;
}

export async function sonarrOverview(inst: ArrInstance) {
  const c = inst.client;
  const k = inst.id;
  const now = new Date();
  const end = new Date(now.getTime() + 14 * 86_400_000);
  const [series, missing, queue, calendar, disks] = await Promise.all([
    cache.get(`${k}:series`, 60_000, () => c.get<SonarrSeries[]>('/api/v3/series')),
    cache.get(`${k}:missing`, 60_000, () =>
      c.get<{ totalRecords: number }>('/api/v3/wanted/missing', { pageSize: 1, monitored: true }),
    ),
    arrQueue(inst),
    cache.get(`${k}:calendar`, 5 * 60_000, () =>
      c.get<SonarrEpisode[]>('/api/v3/calendar', {
        start: new Date(now.getTime() - 86_400_000).toISOString(),
        end: end.toISOString(),
        includeSeries: true,
        unmonitored: false,
      }),
    ),
    arrDisks(inst),
  ]);

  const stats = series.reduce(
    (acc, s) => {
      acc.episodes += s.statistics?.episodeCount ?? 0;
      acc.episodeFiles += s.statistics?.episodeFileCount ?? 0;
      acc.sizeOnDisk += s.statistics?.sizeOnDisk ?? 0;
      return acc;
    },
    { episodes: 0, episodeFiles: 0, sizeOnDisk: 0 },
  );

  const upcoming: UpcomingItem[] = calendar
    .filter((e) => e.airDateUtc)
    .map((e) => ({
      id: `${k}-${e.id}`,
      source: 'sonarr',
      title: e.series?.title ?? 'Unknown series',
      subtitle: `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')} · ${e.title}`,
      date: e.airDateUtc!,
      kind: 'episode',
      hasFile: e.hasFile,
      monitored: e.monitored,
      network: e.series?.network,
      poster: coverUrl(inst, e.series?.images),
    }));

  const recent = [...series]
    .filter((s) => s.added)
    .sort((a, b) => b.added!.localeCompare(a.added!))
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      network: s.network,
      status: s.status,
      progress: (s.statistics?.percentOfEpisodes ?? 0) / 100,
      poster: coverUrl(inst, s.images),
    }));

  return {
    stats: {
      series: series.length,
      monitored: series.filter((s) => s.monitored).length,
      continuing: series.filter((s) => s.status === 'continuing').length,
      ended: series.filter((s) => s.status === 'ended').length,
      ...stats,
      missing: missing.totalRecords,
    },
    queue,
    upcoming,
    recent,
    disks,
  };
}

/* ------------------------------------------------------------------ */
/* Radarr                                                              */
/* ------------------------------------------------------------------ */

export const radarr = derived('radarr', (s) => arrClient('radarr', s.url, s.apiKey));

interface RadarrMovie {
  id: number;
  title: string;
  year?: number;
  monitored: boolean;
  hasFile: boolean;
  isAvailable: boolean;
  status: string;
  sizeOnDisk?: number;
  studio?: string;
  added?: string;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  images?: ArrImage[];
  movieFile?: { quality?: { quality?: { name?: string } } };
}

export async function radarrOverview(inst: ArrInstance) {
  const c = inst.client;
  const k = inst.id;
  const now = Date.now();
  const start = new Date(now - 86_400_000);
  const end = new Date(now + 30 * 86_400_000);
  const [movies, queue, calendar, disks] = await Promise.all([
    cache.get(`${k}:movies`, 60_000, () => c.get<RadarrMovie[]>('/api/v3/movie')),
    arrQueue(inst),
    cache.get(`${k}:calendar`, 5 * 60_000, () =>
      c.get<RadarrMovie[]>('/api/v3/calendar', {
        start: start.toISOString(),
        end: end.toISOString(),
        unmonitored: false,
      }),
    ),
    arrDisks(inst),
  ]);

  const upcoming: UpcomingItem[] = [];
  for (const m of calendar) {
    const releases: [UpcomingItem['kind'], string | undefined][] = [
      ['cinema', m.inCinemas],
      ['digital', m.digitalRelease],
      ['physical', m.physicalRelease],
    ];
    for (const [kind, date] of releases) {
      if (!date) continue;
      const t = Date.parse(date);
      if (t < start.getTime() || t > end.getTime()) continue;
      upcoming.push({
        id: `${k}-${m.id}-${kind}`,
        source: 'radarr',
        title: m.title,
        subtitle: m.year ? String(m.year) : undefined,
        date,
        kind,
        hasFile: m.hasFile,
        monitored: m.monitored,
        network: m.studio,
        poster: coverUrl(inst, m.images),
      });
    }
  }

  const qualities = new Map<string, number>();
  for (const m of movies) {
    const q = m.movieFile?.quality?.quality?.name;
    if (m.hasFile && q) qualities.set(q, (qualities.get(q) ?? 0) + 1);
  }

  return {
    stats: {
      movies: movies.length,
      monitored: movies.filter((m) => m.monitored).length,
      downloaded: movies.filter((m) => m.hasFile).length,
      missing: movies.filter((m) => m.monitored && !m.hasFile && m.isAvailable).length,
      unreleased: movies.filter((m) => m.monitored && !m.hasFile && !m.isAvailable).length,
      sizeOnDisk: movies.reduce((a, m) => a + (m.sizeOnDisk ?? 0), 0),
    },
    qualities: [...qualities.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    queue,
    upcoming: upcoming.sort((a, b) => a.date.localeCompare(b.date)),
    recent: [...movies]
      .filter((m) => m.added)
      .sort((a, b) => b.added!.localeCompare(a.added!))
      .slice(0, 10)
      .map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
        hasFile: m.hasFile,
        poster: coverUrl(inst, m.images),
      })),
    disks,
  };
}

/* ------------------------------------------------------------------ */
/* Queue actions                                                       */
/* ------------------------------------------------------------------ */

export const QUEUE_ACTIONS = ['remove', 'remove-keep', 'blocklist', 'blocklist-search', 'grab'] as const;
export type QueueAction = (typeof QUEUE_ACTIONS)[number];

/**
 * Acts on a queue item:
 *  - remove            remove from the queue and the download client
 *  - remove-keep       remove from the queue but leave the download in the client
 *  - blocklist         remove + blocklist the release, don't search again
 *  - blocklist-search  remove + blocklist + search for another release
 *  - grab              grab a delayed/pending release now
 */
export async function queueAction(inst: ArrInstance, id: number, action: QueueAction) {
  const path = `/api/v3/queue/${id}`;
  switch (action) {
    case 'grab':
      await inst.client.post(`/api/v3/queue/grab/${id}`, {});
      break;
    case 'remove':
      await inst.client.del(path, { removeFromClient: true, blocklist: false, skipRedownload: true });
      break;
    case 'remove-keep':
      await inst.client.del(path, { removeFromClient: false, blocklist: false, skipRedownload: true });
      break;
    case 'blocklist':
      await inst.client.del(path, { removeFromClient: true, blocklist: true, skipRedownload: true });
      break;
    case 'blocklist-search':
      await inst.client.del(path, { removeFromClient: true, blocklist: true, skipRedownload: false });
      break;
  }
  cache.delete(`${inst.id}:queue`);
}

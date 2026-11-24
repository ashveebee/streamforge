import { derived } from '../settings.js';
import { cache } from '../lib/cache.js';
import { arrClient } from './arr.js';
import type { ServiceClient } from '../lib/http.js';

/*
 * Lidarr (music) and Readarr (books). Both speak the *arr v1 API, with
 * artists/albums in Lidarr and authors/books in Readarr playing the roles of
 * series/episodes.
 */

export type BookOrMusic = 'lidarr' | 'readarr';
export const lidarr = derived('lidarr', (s) => arrClient('lidarr', s.url, s.apiKey));
export const readarr = derived('readarr', (s) => arrClient('readarr', s.url, s.apiKey));
export const clientOf = (kind: BookOrMusic) => (kind === 'lidarr' ? lidarr() : readarr());

interface Image {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}
const cover = (images?: Image[]) => {
  const img = images?.find((i) => i.coverType === 'cover' || i.coverType === 'poster') ?? images?.[0];
  return img?.remoteUrl && /^https:\/\//.test(img.remoteUrl) ? img.remoteUrl : undefined;
};

interface Artist {
  id: number;
  artistName?: string;
  authorName?: string;
  monitored: boolean;
  status?: string;
  statistics?: {
    albumCount?: number;
    bookCount?: number;
    trackFileCount?: number;
    bookFileCount?: number;
    totalTrackCount?: number;
    totalBookCount?: number;
    sizeOnDisk?: number;
  };
}
interface Release {
  id: number;
  title: string;
  releaseDate?: string;
  monitored?: boolean;
  images?: Image[];
  artist?: { artistName: string; images?: Image[] };
  author?: { authorName: string; images?: Image[] };
  statistics?: { trackFileCount?: number; bookFileCount?: number; totalTrackCount?: number; bookCount?: number };
}
interface QueueRecord {
  id: number;
  title: string;
  status: string;
  trackedDownloadState?: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  errorMessage?: string;
  protocol?: string;
  downloadClient?: string;
  quality?: { quality?: { name?: string } };
  artist?: { artistName: string };
  album?: { title: string };
  author?: { authorName: string };
  book?: { title: string };
}

const words = (kind: BookOrMusic) =>
  kind === 'lidarr'
    ? { library: '/api/v1/artist', include: { includeArtist: true, includeAlbum: true }, search: 'AlbumSearch', idsKey: 'albumIds', missingSearch: 'MissingAlbumSearch' }
    : { library: '/api/v1/author', include: { includeAuthor: true, includeBook: true }, search: 'BookSearch', idsKey: 'bookIds', missingSearch: 'MissingBookSearch' };

const creatorOf = (r: Release) => r.artist?.artistName ?? r.author?.authorName ?? '';

function need(kind: BookOrMusic): ServiceClient {
  const c = clientOf(kind);
  if (!c) throw new Error(`${kind} is not configured`);
  return c;
}

export async function musicOverview(kind: BookOrMusic) {
  const client = need(kind);
  const w = words(kind);
  const now = new Date();
  const [creators, queue, upcoming] = await Promise.all([
    cache.get(`${kind}:library`, 60_000, () => client.get<Artist[]>(w.library)),
    cache.get(`${kind}:queue`, 5_000, () =>
      client.get<{ totalRecords: number; records: QueueRecord[] }>('/api/v1/queue', { pageSize: 50, ...w.include }),
    ),
    cache.get(`${kind}:calendar`, 300_000, () =>
      client.get<Release[]>('/api/v1/calendar', {
        start: new Date(now.getTime() - 86_400_000).toISOString(),
        end: new Date(now.getTime() + 60 * 86_400_000).toISOString(),
        ...(kind === 'lidarr' ? { includeArtist: true } : { includeAuthor: true }),
      }),
    ),
  ]);
  const s = creators.map((c) => c.statistics ?? {});
  const sum = (f: (x: NonNullable<Artist['statistics']>) => number | undefined) => s.reduce((n, x) => n + (f(x) ?? 0), 0);
  return {
    kind,
    stats: {
      creators: creators.length,
      monitored: creators.filter((c) => c.monitored).length,
      releases: sum((x) => x.albumCount ?? x.bookCount),
      files: sum((x) => x.trackFileCount ?? x.bookFileCount),
      total: sum((x) => x.totalTrackCount ?? x.totalBookCount),
      sizeOnDisk: sum((x) => x.sizeOnDisk),
    },
    queue: queue.records.map((r) => ({
      id: r.id,
      title: r.artist?.artistName ?? r.author?.authorName ?? r.title,
      subtitle: r.album?.title ?? r.book?.title,
      releaseTitle: r.title,
      status: r.trackedDownloadState ?? r.status,
      client: r.downloadClient,
      protocol: r.protocol,
      quality: r.quality?.quality?.name,
      size: r.size,
      sizeLeft: r.sizeleft,
      progress: r.size > 0 ? Math.max(0, Math.min(1, 1 - r.sizeleft / r.size)) : 0,
      timeLeft: r.timeleft,
      errorMessage: r.errorMessage,
    })),
    upcoming: upcoming
      .filter((r) => r.releaseDate)
      .sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!))
      .slice(0, 20)
      .map((r) => ({ id: r.id, title: r.title, creator: creatorOf(r), date: r.releaseDate!, cover: cover(r.images ?? r.artist?.images ?? r.author?.images) })),
  };
}

const PAGE = 25;

export async function musicMissing(kind: BookOrMusic, page = 1) {
  const client = need(kind);
  const res = await cache.get(`${kind}:missing:${page}`, 30_000, () =>
    client.get<{ totalRecords: number; records: Release[] }>('/api/v1/wanted/missing', {
      page,
      pageSize: PAGE,
      sortKey: 'releaseDate',
      sortDirection: 'descending',
      monitored: true,
      ...(kind === 'lidarr' ? { includeArtist: true } : { includeAuthor: true }),
    }),
  );
  return {
    total: res.totalRecords,
    page,
    pageSize: PAGE,
    items: res.records.map((r) => ({ id: r.id, title: r.title, subtitle: creatorOf(r), date: r.releaseDate, poster: cover(r.images ?? r.artist?.images ?? r.author?.images) })),
  };
}

/** Searches for specific albums/books, or everything missing when `ids` is empty. */
export async function musicSearch(kind: BookOrMusic, ids: number[]) {
  const w = words(kind);
  const body = ids.length ? { name: w.search, [w.idsKey]: ids } : { name: w.missingSearch };
  const cmd = await need(kind).post<{ id: number }>('/api/v1/command', body);
  return { ok: true, commandId: cmd?.id };
}

export async function musicQueueRemove(kind: BookOrMusic, id: number, blocklist: boolean) {
  await need(kind).del(`/api/v1/queue/${id}`, { removeFromClient: true, blocklist });
  cache.delete(`${kind}:queue`);
}

/* For search: library lookups. */
export async function musicLibrary(kind: BookOrMusic) {
  const client = need(kind);
  return cache.get(`${kind}:library`, 60_000, () => client.get<Artist[]>(words(kind).library));
}
export const creatorName = (a: Artist) => a.artistName ?? a.authorName ?? '';

import { config } from '../config.js';
import { createClient } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import type { HealthProbe } from './types.js';

export const seerr = config.seerr
  ? createClient('seerr', config.seerr.baseUrl, { 'X-Api-Key': config.seerr.apiKey })
  : undefined;

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface SeerrStatus {
  version: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
  restartRequired?: boolean;
}

export async function seerrProbe(): Promise<HealthProbe> {
  const s = await seerr!.get<SeerrStatus>('/api/v1/status');
  // /status is public, so also hit an authenticated endpoint to validate the key.
  await seerr!.get('/api/v1/request/count');
  const issues: HealthProbe['issues'] = [];
  if (s.restartRequired) issues.push({ level: 'warning', message: 'Restart required to apply settings' });
  if (s.updateAvailable)
    issues.push({
      level: 'info',
      message: s.commitsBehind ? `Update available (${s.commitsBehind} commits behind)` : 'Update available',
    });
  return { version: s.version, issues };
}

interface RequestCount {
  total: number;
  movie: number;
  tv: number;
  pending: number;
  approved: number;
  declined: number;
  processing: number;
  available: number;
  completed?: number;
}

interface SeerrRequest {
  id: number;
  status: number; // 1 pending, 2 approved, 3 declined, 4 failed, 5 completed
  type: 'movie' | 'tv';
  is4k?: boolean;
  createdAt: string;
  updatedAt?: string;
  seasons?: { seasonNumber: number }[];
  media: { tmdbId: number; mediaType: 'movie' | 'tv'; status: number };
  requestedBy?: { id: number; displayName?: string; avatar?: string; email?: string };
  modifiedBy?: { displayName?: string };
}

interface TmdbDetails {
  title?: string;
  name?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  firstAirDate?: string;
}

const REQUEST_STATUS: Record<number, string> = {
  1: 'pending',
  2: 'approved',
  3: 'declined',
  4: 'failed',
  5: 'completed',
};
// Media status describes whether it is actually in the library yet.
const MEDIA_STATUS: Record<number, string> = {
  1: 'unknown',
  2: 'pending',
  3: 'processing',
  4: 'partially available',
  5: 'available',
  6: 'blacklisted',
  7: 'deleted',
};

function details(type: 'movie' | 'tv', tmdbId: number) {
  return cache.get(`seerr:tmdb:${type}:${tmdbId}`, 6 * 3600_000, () =>
    seerr!.get<TmdbDetails>(`/api/v1/${type}/${tmdbId}`).catch(() => ({}) as TmdbDetails),
  );
}

async function requests(filter: 'all' | 'pending' | 'approved' | 'processing' | 'available', take: number) {
  return cache.get(`seerr:requests:${filter}:${take}`, 15_000, async () => {
    const res = await seerr!.get<{ pageInfo: { results: number }; results: SeerrRequest[] }>('/api/v1/request', {
      take,
      skip: 0,
      sort: 'added',
      filter,
    });
    return Promise.all(
      res.results.map(async (r) => {
        const d = await details(r.type, r.media.tmdbId);
        const date = d.releaseDate ?? d.firstAirDate;
        return {
          id: r.id,
          type: r.type,
          title: d.title ?? d.name ?? `TMDB #${r.media.tmdbId}`,
          year: date ? Number(date.slice(0, 4)) : undefined,
          poster: d.posterPath ? `${TMDB_IMG}/w342${d.posterPath}` : undefined,
          backdrop: d.backdropPath ? `${TMDB_IMG}/w780${d.backdropPath}` : undefined,
          status: REQUEST_STATUS[r.status] ?? 'unknown',
          mediaStatus: MEDIA_STATUS[r.media.status] ?? 'unknown',
          is4k: !!r.is4k,
          seasons: r.seasons?.map((s) => s.seasonNumber) ?? [],
          requestedBy: r.requestedBy?.displayName ?? r.requestedBy?.email ?? 'Unknown',
          modifiedBy: r.modifiedBy?.displayName,
          createdAt: r.createdAt,
        };
      }),
    );
  });
}

export async function seerrOverview() {
  const [counts, recent, pending] = await Promise.all([
    cache.get('seerr:count', 15_000, () => seerr!.get<RequestCount>('/api/v1/request/count')),
    requests('all', 16),
    requests('pending', 12),
  ]);
  return {
    counts: {
      total: counts.total,
      movie: counts.movie,
      tv: counts.tv,
      pending: counts.pending,
      approved: counts.approved,
      declined: counts.declined,
      processing: counts.processing,
      available: counts.available,
    },
    recent,
    pending,
  };
}

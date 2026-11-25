import { derived } from '../settings.js';
import { createClient, type ServiceClient } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import type { HealthProbe } from './types.js';
import { emit } from './notify.js';

export const seerrClient = (url: string, apiKey: string) => createClient('seerr', url, { 'X-Api-Key': apiKey });
export const seerr = derived('seerr', (s) => (s.url && s.apiKey ? seerrClient(s.url, s.apiKey) : undefined));

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface SeerrStatus {
  version: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
  restartRequired?: boolean;
}

export async function seerrProbe(client: ServiceClient = seerr()!): Promise<HealthProbe> {
  const s = await client.get<SeerrStatus>('/api/v1/status');
  // /status is public, so also hit an authenticated endpoint to validate the key.
  await client.get('/api/v1/request/count');
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
    seerr()!.get<TmdbDetails>(`/api/v1/${type}/${tmdbId}`).catch(() => ({}) as TmdbDetails),
  );
}

async function requests(filter: 'all' | 'pending' | 'approved' | 'processing' | 'available', take: number) {
  return cache.get(`seerr:requests:${filter}:${take}`, 15_000, async () => {
    const res = await seerr()!.get<{ pageInfo: { results: number }; results: SeerrRequest[] }>('/api/v1/request', {
      take,
      skip: 0,
      sort: 'added',
      filter,
    });
    return Promise.all(res.results.map(normalise));
  });
}

async function normalise(r: SeerrRequest) {
  const d = await details(r.type, r.media.tmdbId);
  const date = d.releaseDate ?? d.firstAirDate;
  return {
    id: r.id,
    type: r.type,
    tmdbId: r.media.tmdbId,
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
}

/** The Seerr user linked to a Jellyfin user (Seerr stores the Jellyfin id) or a Plex account (numeric id). */
export async function seerrUserFor(jellyfinUserId: string) {
  const users = await cache.get('seerr:users', 10 * 60_000, () =>
    seerr()!.get<{ results: { id: number; jellyfinUserId?: string; plexId?: number; displayName?: string }[] }>('/api/v1/user', { take: 1000 }),
  );
  if (/^\d+$/.test(jellyfinUserId)) return users.results.find((u) => u.plexId === Number(jellyfinUserId));
  const id = jellyfinUserId.replace(/-/g, '').toLowerCase();
  return users.results.find((u) => u.jellyfinUserId?.replace(/-/g, '').toLowerCase() === id);
}

/** One user's own requests, newest first. */
export async function userRequests(jellyfinUserId: string, take = 20) {
  const user = await seerrUserFor(jellyfinUserId);
  if (!user) return { linked: false, requests: [] };
  const res = await cache.get(`seerr:requests:user:${user.id}`, 30_000, () =>
    seerr()!.get<{ results: SeerrRequest[] }>(`/api/v1/user/${user.id}/requests`, { take, skip: 0 }),
  );
  return { linked: true, requests: await Promise.all(res.results.map(normalise)) };
}

export async function seerrOverview() {
  const [counts, recent, pending] = await Promise.all([
    cache.get('seerr:count', 15_000, () => seerr()!.get<RequestCount>('/api/v1/request/count')),
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

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

export async function decideRequest(id: number, decision: 'approve' | 'decline') {
  await seerr()!.post(`/api/v1/request/${id}/${decision}`, {});
  cache.delete('seerr:requests:');
  cache.delete('seerr:count');
}

/*
 * Watches for new pending requests so admins can be notified. The first look
 * after start-up only records what is already waiting.
 */
let known: Set<number> | undefined;

async function checkPending() {
  if (!seerr()) {
    known = undefined;
    return;
  }
  const pending = await requests('pending', 20);
  const fresh = known ? pending.filter((r) => !known!.has(r.id)) : [];
  known = new Set(pending.map((r) => r.id));
  for (const r of fresh) {
    emit('request_pending', {
      title: `New request: ${r.title}${r.year ? ` (${r.year})` : ''}`,
      message: `${r.requestedBy} requested this ${r.type === 'tv' ? `series${r.seasons.length ? ` (season ${r.seasons.join(', ')})` : ''}` : 'movie'}${r.is4k ? ' in 4K' : ''}.`,
      url: '/seerr',
    });
  }
}

export function startSeerrWatch() {
  const tick = () => void checkPending().catch(() => undefined);
  tick();
  setInterval(tick, 2 * 60_000).unref();
}

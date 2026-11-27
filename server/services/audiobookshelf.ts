import { derived } from '../settings.js';
import { cache } from '../lib/cache.js';
import { buildUrl, createClient, requestRaw, UpstreamError, type ServiceClient } from '../lib/http.js';
import type { HealthIssue, HealthProbe } from './types.js';

/*
 * Audiobookshelf: audiobook and podcast libraries, who's listening right now,
 * recent listening sessions and new additions.
 *
 * Authenticates with an API key (Settings → API Keys) or a user's API token,
 * sent as a Bearer token. Listening activity is only visible to admin keys;
 * with a non-admin key those parts of the page are just empty.
 */

const headers = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}` });
export const audiobookshelfClient = (url: string, apiKey: string) => createClient('audiobookshelf', url.replace(/\/+$/, ''), headers(apiKey));
const current = derived('audiobookshelf', (s) => (s.url && s.apiKey ? { client: audiobookshelfClient(s.url, s.apiKey), apiKey: s.apiKey } : undefined));
export const audiobookshelf = () => current()?.client;

function need() {
  const c = current();
  if (!c) throw new Error('Audiobookshelf is not configured');
  return c;
}

interface Status {
  app?: string;
  serverVersion?: string;
  isInit?: boolean;
}
interface Library {
  id: string;
  name: string;
  mediaType: 'book' | 'podcast' | string;
  displayOrder?: number;
}
interface Me {
  username?: string;
  type?: string;
}

export async function audiobookshelfProbe(client: ServiceClient = need().client): Promise<HealthProbe> {
  // /status is public and carries the version; /api/me proves the key works.
  const [status, me, libs] = await Promise.all([
    client.get<Status>('/status').catch(() => ({}) as Status),
    client.get<Me>('/api/me'),
    client.get<{ libraries: Library[] }>('/api/libraries').catch(() => ({ libraries: [] as Library[] })),
  ]);
  const issues: HealthIssue[] = [];
  if (status.isInit === false) issues.push({ level: 'warning', message: 'Audiobookshelf has not been set up yet' });
  if (!libs.libraries?.length) issues.push({ level: 'warning', message: 'No libraries found' });
  if (me.type && me.type !== 'admin' && me.type !== 'root') {
    issues.push({ level: 'warning', message: 'This API key is not an admin’s, so listening activity is hidden' });
  }
  return {
    version: status.serverVersion,
    issues,
    meta: { libraries: libs.libraries?.length ?? 0, user: me.username },
  };
}

/* -------------------------------- overview -------------------------------- */

interface LibraryStats {
  totalItems?: number;
  totalAuthors?: number;
  totalDuration?: number;
  totalSize?: number;
  numAudioTracks?: number;
}
interface ItemMetadata {
  title?: string;
  authorName?: string;
  author?: string;
  narratorName?: string;
  seriesName?: string;
}
interface LibraryItem {
  id: string;
  libraryId: string;
  mediaType: string;
  addedAt?: number;
  size?: number;
  media?: { metadata?: ItemMetadata; duration?: number; numEpisodes?: number; numTracks?: number; coverPath?: string | null };
}
interface DeviceInfo {
  clientName?: string;
  deviceName?: string;
  osName?: string;
  browserName?: string;
  model?: string;
  manufacturer?: string;
}
interface PlaybackSession {
  id: string;
  userId?: string;
  user?: { id?: string; username?: string };
  libraryItemId?: string;
  displayTitle?: string;
  displayAuthor?: string;
  mediaType?: string;
  duration?: number;
  currentTime?: number;
  timeListening?: number;
  playMethod?: number;
  mediaPlayer?: string;
  deviceInfo?: DeviceInfo;
  startedAt?: number;
  updatedAt?: number;
}

const device = (d?: DeviceInfo, player?: string) =>
  [d?.clientName ?? player, d?.deviceName ?? ([d?.manufacturer, d?.model].filter(Boolean).join(' ') || d?.browserName), d?.osName].filter(Boolean).join(' · ') || undefined;
const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : undefined);

/** Where the browser loads an item's cover (proxied, so the key stays here). */
const cover = (id: string) => `/api/audiobookshelf/cover/${encodeURIComponent(id)}`;

export async function audiobookshelfOverview() {
  const { client: c } = need();
  return cache.get('audiobookshelf:overview', 15_000, async () => {
    const [{ libraries = [] }, online, history] = await Promise.all([
      c.get<{ libraries: Library[] }>('/api/libraries'),
      // Admin-only: a member's key gets 403 here, which just means "no activity".
      c.get<{ openSessions?: PlaybackSession[]; usersOnline?: { id: string; username?: string }[] }>('/api/users/online').catch(() => ({ openSessions: [], usersOnline: [] })),
      c.get<{ sessions?: PlaybackSession[]; total?: number }>('/api/sessions', { itemsPerPage: 15, page: 0 }).catch(() => ({ sessions: [], total: 0 })),
    ]);
    const ordered = [...libraries].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    const perLibrary = await Promise.all(
      ordered.map(async (l) => {
        const [stats, recent] = await Promise.all([
          c.get<LibraryStats>(`/api/libraries/${encodeURIComponent(l.id)}/stats`).catch(() => ({}) as LibraryStats),
          c
            .get<{ results?: LibraryItem[] }>(`/api/libraries/${encodeURIComponent(l.id)}/items`, { sort: 'addedAt', desc: 1, limit: 12, minified: 1 })
            .catch(() => ({ results: [] as LibraryItem[] })),
        ]);
        return { library: l, stats, recent: recent.results ?? [] };
      }),
    );
    const names = new Map((online.usersOnline ?? []).map((u) => [u.id, u.username]));
    const userOf = (s: PlaybackSession) => s.user?.username ?? (s.userId ? names.get(s.userId) : undefined);

    const libs = perLibrary.map(({ library: l, stats }) => ({
      id: l.id,
      name: l.name,
      kind: l.mediaType === 'podcast' ? ('podcast' as const) : ('book' as const),
      items: stats.totalItems ?? 0,
      authors: stats.totalAuthors ?? 0,
      duration: stats.totalDuration ?? 0,
      size: stats.totalSize ?? 0,
      tracks: stats.numAudioTracks ?? 0,
    }));
    const total = (k: 'items' | 'duration' | 'size', kind?: 'book' | 'podcast') => libs.filter((l) => !kind || l.kind === kind).reduce((n, l) => n + l[k], 0);

    return {
      totals: {
        books: total('items', 'book'),
        podcasts: total('items', 'podcast'),
        duration: total('duration'),
        size: total('size'),
      },
      libraries: libs,
      listening: (online.openSessions ?? []).map((s) => ({
        id: s.id,
        user: userOf(s),
        title: s.displayTitle ?? '',
        author: s.displayAuthor,
        kind: s.mediaType === 'podcast' ? ('podcast' as const) : ('book' as const),
        position: s.currentTime ?? 0,
        duration: s.duration ?? 0,
        device: device(s.deviceInfo, s.mediaPlayer),
        cover: s.libraryItemId ? cover(s.libraryItemId) : undefined,
        updatedAt: iso(s.updatedAt),
      })),
      recentSessions: (history.sessions ?? []).map((s) => ({
        id: s.id,
        user: userOf(s),
        title: s.displayTitle ?? '',
        author: s.displayAuthor,
        kind: s.mediaType === 'podcast' ? ('podcast' as const) : ('book' as const),
        listened: s.timeListening ?? 0,
        device: device(s.deviceInfo, s.mediaPlayer),
        at: iso(s.updatedAt ?? s.startedAt),
      })),
      recentlyAdded: perLibrary
        .flatMap(({ library: l, recent }) =>
          recent.map((i) => ({
            id: i.id,
            libraryId: l.id,
            kind: i.mediaType === 'podcast' ? ('podcast' as const) : ('book' as const),
            title: i.media?.metadata?.title ?? '',
            author: i.media?.metadata?.authorName ?? i.media?.metadata?.author,
            narrator: i.media?.metadata?.narratorName,
            series: i.media?.metadata?.seriesName,
            duration: i.media?.duration,
            episodes: i.media?.numEpisodes,
            cover: i.media?.coverPath ? cover(i.id) : undefined,
            addedAt: iso(i.addedAt),
          })),
        )
        .sort((a, b) => String(b.addedAt ?? '').localeCompare(String(a.addedAt ?? '')))
        .slice(0, 18),
    };
  });
}

/* --------------------------------- actions -------------------------------- */

const ID = /^[\w-]{1,64}$/;
export const isValidId = (id: string) => ID.test(id);

/** Scans one library for new and changed files. */
export async function audiobookshelfScan(libraryId: string) {
  const { client: c, apiKey } = need();
  if (!isValidId(libraryId)) throw new Error('Invalid library');
  // Answers with a plain "OK", not JSON.
  const res = await requestRaw(buildUrl(c.baseUrl, `/api/libraries/${libraryId}/scan`), { method: 'POST', headers: headers(apiKey), service: 'audiobookshelf' });
  if (!res.ok) throw new UpstreamError(`HTTP ${res.status} ${res.status === 401 || res.status === 403 ? 'Unauthorised — scanning needs an admin key' : res.statusText}`.trim(), res.status, 'audiobookshelf');
  cache.delete('audiobookshelf:');
  return { ok: true };
}

/** An item's cover image. */
export function audiobookshelfCover(id: string, width?: number) {
  const { client: c, apiKey } = need();
  return requestRaw(buildUrl(c.baseUrl, `/api/items/${id}/cover`, { width: width ?? 300, format: 'webp' }), {
    headers: { ...headers(apiKey), Accept: 'image/*' },
    service: 'audiobookshelf',
  });
}

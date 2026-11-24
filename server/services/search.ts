import { cache } from '../lib/cache.js';
import { HttpError } from '../lib/handle.js';
import { isConfigured } from '../settings.js';
import { coverUrl } from './arr.js';
import { arrInstance, arrInstances, type ArrInstance } from './instances.js';
import { jf, type JfCtx } from './jellyfin.js';
import { creatorName, musicLibrary } from './music.js';
import { seerr, seerrUserFor } from './seerr.js';

/*
 * Global search. One query fans out to every connected service the user can
 * see; each source is best-effort, so a slow or offline service just drops
 * out of the results. Only the first few hits per source are returned.
 */

const TMDB_IMG = 'https://image.tmdb.org/t/p/w185';
const PER_SOURCE = 6;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export interface SearchHit {
  key: string;
  source: 'jellyfin' | 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'seerr';
  title: string;
  subtitle?: string;
  year?: number;
  image?: string;
  /** App path to open. */
  path?: string;
  /** For discover results. */
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
  tvdbId?: number;
  /** available | partial | requested | processing | missing | downloaded | none */
  status?: string;
  overview?: string;
}

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  SeriesName?: string;
  AlbumArtist?: string;
  ImageTags?: { Primary?: string };
  SeriesId?: string;
  SeriesPrimaryImageTag?: string;
}

async function jellyfinHits(ctx: JfCtx, q: string): Promise<SearchHit[]> {
  const res = await jf<{ Items: JfItem[] }>(`/Users/${ctx.userId}/Items`, ctx.token, ctx.deviceId, {
    searchTerm: q,
    Recursive: true,
    Limit: PER_SOURCE * 2,
    IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum,MusicArtist,Book,AudioBook',
    Fields: 'PrimaryImageAspectRatio',
    EnableTotalRecordCount: false,
  });
  return res.Items.slice(0, PER_SOURCE * 2).map((i) => {
    const imgId = i.ImageTags?.Primary ? i.Id : i.SeriesId;
    const tag = i.ImageTags?.Primary ?? i.SeriesPrimaryImageTag;
    return {
      key: `jf:${i.Id}`,
      source: 'jellyfin',
      title: i.Name,
      subtitle: [i.Type === 'Episode' ? i.SeriesName : i.AlbumArtist, i.Type.replace(/([a-z])([A-Z])/g, '$1 $2')].filter(Boolean).join(' · '),
      year: i.ProductionYear,
      image: imgId && tag ? `/api/jellyfin/image/items/${imgId}/Primary?w=120&tag=${encodeURIComponent(tag)}` : undefined,
      status: 'available',
    };
  });
}

interface ArrRow {
  id: number;
  title: string;
  year?: number;
  hasFile?: boolean;
  monitored?: boolean;
  tmdbId?: number;
  tvdbId?: number;
  images?: { coverType: string; url?: string; remoteUrl?: string }[];
  statistics?: { episodeFileCount?: number; episodeCount?: number };
}

function score(title: string, q: string) {
  const t = norm(title);
  const n = norm(q);
  if (t === n) return 3;
  if (t.startsWith(n)) return 2;
  return t.includes(n) ? 1 : 0;
}

async function arrHits(inst: ArrInstance, q: string): Promise<SearchHit[]> {
  const isTv = inst.kind === 'sonarr';
  const rows = await cache.get(`${inst.id}:${isTv ? 'series' : 'movies'}`, 60_000, () => inst.client.get<ArrRow[]>(isTv ? '/api/v3/series' : '/api/v3/movie'));
  return rows
    .map((r) => ({ r, s: score(r.title, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, PER_SOURCE)
    .map(({ r }) => ({
      key: `${inst.id}:${r.id}`,
      source: inst.kind,
      title: r.title,
      subtitle: [inst.primary ? undefined : inst.name, isTv ? `${r.statistics?.episodeFileCount ?? 0}/${r.statistics?.episodeCount ?? 0} episodes` : r.hasFile ? 'Downloaded' : r.monitored ? 'Missing' : 'Not monitored'].filter(Boolean).join(' · '),
      year: r.year,
      image: coverUrl(inst, r.images),
      path: `/${inst.kind}${inst.primary ? '' : `?instance=${encodeURIComponent(inst.id)}`}`,
      tmdbId: r.tmdbId,
      tvdbId: r.tvdbId,
      status: isTv ? undefined : r.hasFile ? 'downloaded' : 'missing',
    }));
}

async function musicHits(kind: 'lidarr' | 'readarr', q: string): Promise<SearchHit[]> {
  const rows = await musicLibrary(kind);
  return rows
    .map((r) => ({ r, s: score(creatorName(r), q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, PER_SOURCE)
    .map(({ r }) => ({ key: `${kind}:${r.id}`, source: kind, title: creatorName(r), subtitle: kind === 'lidarr' ? 'Artist' : 'Author', path: `/${kind}` }));
}

interface SeerrResult {
  id: number;
  mediaType: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  releaseDate?: string;
  firstAirDate?: string;
  posterPath?: string;
  overview?: string;
  mediaInfo?: { status?: number; tvdbId?: number };
}

const SEERR_STATUS: Record<number, string> = { 2: 'requested', 3: 'processing', 4: 'partial', 5: 'available' };

async function seerrHits(q: string): Promise<SearchHit[]> {
  const res = await seerr()!.get<{ results: SeerrResult[] }>('/api/v1/search', { query: q, page: 1, language: 'en' });
  return res.results
    .filter((r) => r.mediaType === 'movie' || r.mediaType === 'tv')
    .slice(0, PER_SOURCE * 2)
    .map((r) => {
      const date = r.releaseDate ?? r.firstAirDate;
      return {
        key: `seerr:${r.mediaType}:${r.id}`,
        source: 'seerr' as const,
        title: r.title ?? r.name ?? 'Untitled',
        subtitle: r.mediaType === 'tv' ? 'Series' : 'Movie',
        year: date ? Number(date.slice(0, 4)) || undefined : undefined,
        image: r.posterPath ? `${TMDB_IMG}${r.posterPath}` : undefined,
        mediaType: r.mediaType as 'movie' | 'tv',
        tmdbId: r.id,
        tvdbId: r.mediaInfo?.tvdbId,
        status: SEERR_STATUS[r.mediaInfo?.status ?? 0] ?? 'none',
        overview: r.overview?.slice(0, 240),
      };
    });
}

interface LookupRow extends ArrRow {
  remotePoster?: string;
  overview?: string;
}

/** Without Seerr, admins discover new titles through Sonarr/Radarr's own lookup. */
async function lookupHits(inst: ArrInstance, q: string): Promise<SearchHit[]> {
  const isTv = inst.kind === 'sonarr';
  const rows = await cache.get(`${inst.id}:lookup:${norm(q)}`, 5 * 60_000, () => inst.client.get<LookupRow[]>(isTv ? '/api/v3/series/lookup' : '/api/v3/movie/lookup', { term: q }));
  return rows.slice(0, PER_SOURCE).map((r) => ({
    key: `lookup:${inst.kind}:${r.tmdbId ?? r.tvdbId ?? r.title}`,
    source: inst.kind,
    title: r.title,
    subtitle: isTv ? 'Series' : 'Movie',
    year: r.year,
    image: r.remotePoster ?? r.images?.find((i) => i.coverType === 'poster')?.remoteUrl,
    mediaType: isTv ? 'tv' : 'movie',
    tmdbId: r.tmdbId,
    tvdbId: r.tvdbId,
    // Lookup results for titles already in the library carry an id.
    status: r.id ? 'in-library' : 'none',
    overview: r.overview?.slice(0, 240),
  }));
}

export async function search(ctx: JfCtx, q: string, can: (area: string) => boolean, isAdmin: boolean) {
  const settle = async (p: Promise<SearchHit[]>) => p.catch(() => [] as SearchHit[]);
  const jobs: Record<string, Promise<SearchHit[]>> = {};
  if (isConfigured('jellyfin')) jobs.library = settle(jellyfinHits(ctx, q));
  const managed: Promise<SearchHit[]>[] = [];
  for (const inst of arrInstances()) if (can(inst.kind)) managed.push(settle(arrHits(inst, q)));
  for (const k of ['lidarr', 'readarr'] as const) if (isConfigured(k) && can(k)) managed.push(settle(musicHits(k, q)));
  jobs.managed = Promise.all(managed).then((l) => l.flat());
  const canRequest = isAdmin || can('requests');
  if (isConfigured('seerr') && (canRequest || can('seerr'))) jobs.discover = settle(seerrHits(q));
  else if (isAdmin) {
    const inst = [arrInstance('radarr'), arrInstance('sonarr')].filter(Boolean) as ArrInstance[];
    jobs.discover = Promise.all(inst.map((i) => settle(lookupHits(i, q)))).then((l) => l.flat());
  }
  const out = Object.fromEntries(await Promise.all(Object.entries(jobs).map(async ([k, p]) => [k, await p] as const))) as Record<'library' | 'managed' | 'discover', SearchHit[] | undefined>;
  return {
    library: out.library ?? [],
    managed: out.managed ?? [],
    discover: (out.discover ?? []).filter((d) => d.status !== 'in-library'),
    canRequest: canRequest && isConfigured('seerr'),
    canAdd: isAdmin && arrInstances().length > 0,
  };
}

/* -------------------------------- actions -------------------------------- */


export async function requestMedia(jellyfinUserId: string, mediaType: 'movie' | 'tv', tmdbId: number) {
  const c = seerr();
  if (!c) throw new HttpError(404, 'Seerr is not configured', 'not_configured');
  const user = await seerrUserFor(jellyfinUserId).catch(() => undefined);
  if (!user) throw new HttpError(403, 'Your Jellyfin account isn’t linked to a Seerr user yet. Sign in to Seerr once with Jellyfin, then try again.');
  const res = await c.post<{ id: number; status: number }>('/api/v1/request', { mediaType, mediaId: tmdbId, ...(mediaType === 'tv' ? { seasons: 'all' } : {}), userId: user.id });
  cache.delete('seerr:');
  return { ok: true, requestId: res?.id, status: res?.status };
}

/** Adds a title straight to Sonarr/Radarr (default profile and root folder) and searches for it. */
export async function addToArr(kind: 'sonarr' | 'radarr', ids: { tmdbId?: number; tvdbId?: number }, instanceId?: string) {
  const inst = arrInstance(kind, instanceId);
  if (!inst) throw new HttpError(404, `${kind} is not configured`, 'not_configured');
  const c = inst.client;
  const [profiles, roots] = await Promise.all([c.get<{ id: number; name: string }[]>('/api/v3/qualityprofile'), c.get<{ path: string; accessible?: boolean }[]>('/api/v3/rootfolder')]);
  const profile = profiles[0];
  const root = roots.find((r) => r.accessible !== false) ?? roots[0];
  if (!profile || !root) throw new HttpError(400, `Set up a quality profile and root folder in ${inst.name} first.`);
  if (kind === 'radarr') {
    if (!ids.tmdbId) throw new HttpError(400, 'Missing TMDB id');
    const movie = await c.get<Record<string, unknown> & { id?: number; title: string }>('/api/v3/movie/lookup/tmdb', { tmdbId: ids.tmdbId });
    if (movie.id) throw new HttpError(409, `${movie.title} is already in ${inst.name}.`);
    const added = await c.post<{ id: number; title: string }>('/api/v3/movie', {
      ...movie,
      qualityProfileId: profile.id,
      rootFolderPath: root.path,
      monitored: true,
      minimumAvailability: 'released',
      addOptions: { searchForMovie: true },
    });
    cache.delete(`${inst.id}:`);
    return { ok: true, title: added.title, instance: inst.name };
  }
  const term = ids.tvdbId ? `tvdb:${ids.tvdbId}` : ids.tmdbId ? `tmdb:${ids.tmdbId}` : undefined;
  if (!term) throw new HttpError(400, 'Missing TVDB id');
  const found = await c.get<(Record<string, unknown> & { id?: number; title: string; tmdbId?: number; tvdbId?: number })[]>('/api/v3/series/lookup', { term });
  const series = found.find((s) => (ids.tvdbId ? s.tvdbId === ids.tvdbId : s.tmdbId === ids.tmdbId)) ?? found[0];
  if (!series) throw new HttpError(404, 'Sonarr couldn’t find that series.');
  if (series.id) throw new HttpError(409, `${series.title} is already in ${inst.name}.`);
  const added = await c.post<{ id: number; title: string }>('/api/v3/series', {
    ...series,
    qualityProfileId: profile.id,
    rootFolderPath: root.path,
    monitored: true,
    seasonFolder: true,
    addOptions: { monitor: 'all', searchForMissingEpisodes: true },
  });
  cache.delete(`${inst.id}:`);
  return { ok: true, title: added.title, instance: inst.name };
}

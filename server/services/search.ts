import { cache } from '../lib/cache.js';
import { HttpError } from '../lib/handle.js';
import { isConfigured } from '../settings.js';
import { coverUrl } from './arr.js';
import { arrInstance, arrInstances, type ArrInstance } from './instances.js';
import { jf, type JfCtx } from './jellyfin.js';
import { mainEmby, mainPlex, mainSilo } from './mainServer.js';
import { mediaServers } from './mediaServers.js';
import { remote, type JfServerTarget } from './jellyfin.js';
import * as plex from './plex.js';
import * as silo from './silo.js';
import { creatorName, musicLibrary } from './music.js';
import { seerr, seerrUserFor } from './seerr.js';
import { requestSource } from './requestSource.js';

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
  source: 'jellyfin' | 'plex' | 'emby' | 'silo' | 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'seerr';
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
  ProviderIds?: Record<string, string>;
}

/** Title page for an Emby/extra-server movie or series, matched across servers by TMDB id. */
function titlePage(i: JfItem) {
  const tmdb = i.ProviderIds?.Tmdb ?? i.ProviderIds?.tmdb;
  if (!tmdb || !/^\d+$/.test(tmdb) || (i.Type !== 'Movie' && i.Type !== 'Series')) return undefined;
  return `/media/${i.Type === 'Movie' ? 'movie' : 'tv'}/${tmdb}`;
}

/**
 * Library search on the main Jellyfin server, on a main Emby server (`emby`)
 * with the user's token, or on an extra Jellyfin/Emby server with its API key (`asServer`).
 */
async function jellyfinHits(ctx: JfCtx, q: string, emby?: JfServerTarget, asServer = false): Promise<SearchHit[]> {
  const query = {
    userId: ctx.userId,
    searchTerm: q,
    Recursive: true,
    Limit: PER_SOURCE * 2,
    IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum,MusicArtist,Book,AudioBook',
    Fields: 'PrimaryImageAspectRatio,ProviderIds',
    EnableTotalRecordCount: false,
  };
  const res = emby
    ? await remote<{ Items: JfItem[] }>(asServer ? emby : { ...emby, apiKey: ctx.token }, '/Items', asServer ? { ...query, userId: undefined } : query)
    : await jf<{ Items: JfItem[] }>('/Items', ctx.token, ctx.deviceId, query);
  const on = emby ? `&server=${encodeURIComponent(emby.id)}` : '';
  return (res.Items ?? []).slice(0, PER_SOURCE * 2).map((i) => {
    const imgId = i.ImageTags?.Primary ? i.Id : i.SeriesId;
    const tag = i.ImageTags?.Primary ?? i.SeriesPrimaryImageTag;
    return {
      key: emby ? `${emby.id}:${i.Id}` : `jf:${i.Id}`,
      source: emby?.type === 'emby' ? ('emby' as const) : ('jellyfin' as const),
      title: i.Name,
      subtitle: [i.Type === 'Episode' ? i.SeriesName : i.AlbumArtist, (i.Type ?? '').replace(/([a-z])([A-Z])/g, '$1 $2')].filter(Boolean).join(' · '),
      year: i.ProductionYear,
      image: imgId && tag ? `/api/jellyfin/image/items/${imgId}/Primary?w=120&tag=${encodeURIComponent(tag)}${on}` : undefined,
      status: 'available',
      path: emby
        ? (titlePage(i) ?? `/${emby.type}${asServer ? `?instance=${encodeURIComponent(emby.id)}` : ''}`)
        : ['Movie', 'Series', 'Episode', 'Season'].includes(i.Type)
          ? `/media/jellyfin/${i.Id}`
          : '/jellyfin',
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
    .map((r) => ({ r, s: score(r.title ?? '', q) }))
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
      path: r.tmdbId ? `/media/${isTv ? 'tv' : 'movie'}/${r.tmdbId}` : `/${inst.kind}${inst.primary ? '' : `?instance=${encodeURIComponent(inst.id)}`}`,
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
  // Seerr's validator wants %20 rather than + for spaces, so build the query by hand.
  const res = await seerr()!.get<{ results?: SeerrResult[] }>(`/api/v1/search?query=${encodeURIComponent(q)}&page=1`);
  return (res.results ?? [])
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
        path: `/media/${r.mediaType}/${r.id}`,
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
    path: r.tmdbId ? `/media/${isTv ? 'tv' : 'movie'}/${r.tmdbId}` : undefined,
    tvdbId: r.tvdbId,
    // Lookup results for titles already in the library carry an id.
    status: r.id ? 'in-library' : 'none',
    overview: r.overview?.slice(0, 240),
  }));
}

export async function search(ctx: JfCtx, q: string, can: (area: string) => boolean, isAdmin: boolean) {
  // A failing service drops out of the results, but the palette says which one and why.
  const errors: Record<string, string> = {};
  const settle = (name: string) => async (p: Promise<SearchHit[]>) =>
    p.catch((err: unknown) => {
      errors[name] = (err as Error).message;
      console.warn(`[search] ${name}: ${(err as Error).message}`);
      return [] as SearchHit[];
    });
  const jobs: Record<string, Promise<SearchHit[]>> = {};
  const main = mainPlex();
  const emby = mainEmby();
  const si = mainSilo();
  // The sign-in server first, then every other media server, each labelled with where it is.
  const library: Promise<SearchHit[]>[] = [];
  if (main) library.push(settle('Plex')(plex.search(main, q, PER_SOURCE * 2)));
  else if (si) library.push(settle('Silo')(silo.search(si, q, PER_SOURCE * 2)));
  else if (emby) library.push(settle('Emby')(jellyfinHits(ctx, q, emby)));
  else if (isConfigured('jellyfin')) library.push(settle('Jellyfin')(jellyfinHits(ctx, q)));
  const others = mediaServers().filter((s) => s.id !== (main ?? si ?? emby)?.id);
  for (const srv of others) {
    const hits = srv.type === 'plex' ? plex.search(srv, q, PER_SOURCE) : srv.type === 'silo' ? silo.search(srv, q, PER_SOURCE) : jellyfinHits(ctx, q, srv, true);
    library.push(settle(srv.name)(hits.then((list) => list.slice(0, PER_SOURCE).map((h) => ({ ...h, subtitle: [h.subtitle, srv.name].filter(Boolean).join(' · ') })))));
  }
  if (library.length) jobs.library = Promise.all(library).then((l) => l.flat().slice(0, PER_SOURCE * 3));
  const managed: Promise<SearchHit[]>[] = [];
  for (const inst of arrInstances()) if (can(inst.kind)) managed.push(settle(inst.primary ? inst.name : `${inst.kind} ${inst.name}`)(arrHits(inst, q)));
  for (const k of ['lidarr', 'readarr'] as const) if (isConfigured(k) && can(k)) managed.push(settle(k === 'lidarr' ? 'Lidarr' : 'Readarr')(musicHits(k, q)));
  jobs.managed = Promise.all(managed).then((l) => l.flat());
  const canRequest = isAdmin || can('requests');
  const source = await requestSource();
  const siReq = source === 'silo' ? mainSilo() : undefined;
  if (siReq && (canRequest || can('seerr'))) jobs.discover = settle('Silo requests')(silo.searchRequestable(siReq, q, PER_SOURCE * 2));
  else if (source === 'seerr' && (canRequest || can('seerr'))) jobs.discover = settle('Seerr')(seerrHits(q));
  else if (isAdmin) {
    const inst = [arrInstance('radarr'), arrInstance('sonarr')].filter(Boolean) as ArrInstance[];
    jobs.discover = Promise.all(inst.map((i) => settle(`${i.name} lookup`)(lookupHits(i, q)))).then((l) => l.flat());
  }
  const out = Object.fromEntries(await Promise.all(Object.entries(jobs).map(async ([k, p]) => [k, await p] as const))) as Record<'library' | 'managed' | 'discover', SearchHit[] | undefined>;
  return {
    library: out.library ?? [],
    managed: out.managed ?? [],
    discover: (out.discover ?? []).filter((d) => d.status !== 'in-library'),
    canRequest: canRequest && !!source,
    canAdd: isAdmin && arrInstances().length > 0,
    errors,
  };
}

/* -------------------------------- actions -------------------------------- */


interface SeerrTv {
  seasons?: { seasonNumber: number }[];
  mediaInfo?: { seasons?: { seasonNumber: number; status: number }[]; requests?: { status: number; seasons?: { seasonNumber: number }[] }[] };
}

/**
 * Requests a movie or series through Seerr in the user's own name. For series
 * it asks for every season that isn't already available or requested, which
 * works on every Seerr/Overseerr/Jellyseerr version (unlike `seasons: 'all'`).
 * Admins whose Jellyfin account isn't linked in Seerr request as Seerr's admin.
 */
export async function requestMedia(jellyfinUserId: string, isAdmin: boolean, mediaType: 'movie' | 'tv', tmdbId: number) {
  const c = seerr();
  if (!c) throw new HttpError(404, 'Seerr is not configured', 'not_configured');
  const user = await seerrUserFor(jellyfinUserId).catch(() => undefined);
  if (!user && !isAdmin) throw new HttpError(403, 'Your Jellyfin account isn’t linked to a Seerr user yet. Sign in to Seerr once with Jellyfin, then try again.');
  const body: Record<string, unknown> = { mediaType, mediaId: tmdbId, ...(user ? { userId: user.id } : {}) };
  if (mediaType === 'tv') {
    const tv = await c.get<SeerrTv>(`/api/v1/tv/${tmdbId}`);
    const taken = new Set<number>();
    for (const s of tv.mediaInfo?.seasons ?? []) if (s.status >= 2) taken.add(s.seasonNumber);
    for (const r of tv.mediaInfo?.requests ?? []) if (r.status !== 3) for (const s of r.seasons ?? []) taken.add(s.seasonNumber);
    const seasons = (tv.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n > 0 && !taken.has(n));
    if (!seasons.length) throw new HttpError(409, 'Every season is already available or requested.');
    body.seasons = seasons;
  }
  try {
    const res = await c.post<{ id: number; status: number }>('/api/v1/request', body);
    cache.delete('seerr:');
    return { ok: true, requestId: res?.id, status: res?.status, asSelf: !!user };
  } catch (err) {
    // Seerr explains refusals (quota, already requested, …) in its JSON body.
    const m = (err as Error).message.match(/"message"\s*:\s*"([^"]+)"/);
    throw new HttpError(400, m ? `Seerr: ${m[1]}` : (err as Error).message);
  }
}


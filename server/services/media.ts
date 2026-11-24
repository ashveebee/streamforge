import { cache } from '../lib/cache.js';
import { HttpError } from '../lib/handle.js';
import { isConfigured, resolve } from '../settings.js';
import { coverUrl } from './arr.js';
import { arrInstances, type ArrInstance } from './instances.js';
import { jf, libraryItems, type JfCtx } from './jellyfin.js';
import { seerr, seerrUserFor } from './seerr.js';

/*
 * Title details: everything StreamForge knows about one movie or series,
 * keyed by its TMDB id. Metadata (overview, cast, trailer, seasons) comes from
 * Seerr's TMDB proxy when Seerr is connected, otherwise from Radarr/Sonarr's
 * lookup, otherwise from Jellyfin. Availability is merged from Jellyfin,
 * every Sonarr/Radarr instance and Seerr's requests.
 */

const TMDB = 'https://image.tmdb.org/t/p';
const TICKS_PER_MS = 10_000;

export type MediaType = 'movie' | 'tv';

interface SeerrDetails {
  id: number;
  title?: string;
  name?: string;
  tagline?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  runtime?: number;
  episodeRunTime?: number[];
  voteAverage?: number;
  genres?: { name: string }[];
  posterPath?: string;
  backdropPath?: string;
  status?: string;
  networks?: { name: string }[];
  productionCompanies?: { name: string }[];
  credits?: { cast?: { name: string; character?: string; profilePath?: string }[] };
  relatedVideos?: { site?: string; key?: string; type?: string; url?: string; name?: string }[];
  externalIds?: { tvdbId?: number; imdbId?: string };
  seasons?: { seasonNumber: number; episodeCount?: number; name?: string; airDate?: string }[];
  mediaInfo?: {
    status?: number;
    seasons?: { seasonNumber: number; status: number }[];
    requests?: { id: number; status: number; createdAt: string; is4k?: boolean; requestedBy?: { displayName?: string }; seasons?: { seasonNumber: number }[] }[];
  };
}

interface ArrImage {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}
interface ArrMovie {
  id?: number;
  title: string;
  year?: number;
  tmdbId?: number;
  overview?: string;
  runtime?: number;
  genres?: string[];
  certification?: string;
  studio?: string;
  status?: string;
  monitored?: boolean;
  hasFile?: boolean;
  sizeOnDisk?: number;
  path?: string;
  images?: ArrImage[];
  ratings?: { tmdb?: { value?: number }; imdb?: { value?: number } };
  movieFile?: { quality?: { quality?: { name?: string } }; size?: number };
  youTubeTrailerId?: string;
}
interface ArrSeries {
  id?: number;
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
  overview?: string;
  runtime?: number;
  genres?: string[];
  network?: string;
  status?: string;
  monitored?: boolean;
  path?: string;
  images?: ArrImage[];
  ratings?: { value?: number };
  seasons?: { seasonNumber: number; monitored: boolean; statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; sizeOnDisk: number } }[];
  statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; sizeOnDisk: number };
}

const REQUEST_STATUS: Record<number, string> = { 1: 'pending', 2: 'approved', 3: 'declined', 4: 'failed', 5: 'completed' };
const MEDIA_STATUS: Record<number, Availability> = { 2: 'requested', 3: 'processing', 4: 'partial', 5: 'available' };
type Availability = 'available' | 'partial' | 'processing' | 'requested' | 'missing' | 'none';

const remote = (imgs: ArrImage[] | undefined, type: string) => {
  const u = imgs?.find((i) => i.coverType === type)?.remoteUrl;
  return u && /^https:\/\//.test(u) ? u : undefined;
};

async function seerrDetails(type: MediaType, tmdbId: number) {
  if (!isConfigured('seerr')) return undefined;
  return cache.get(`seerr:details:${type}:${tmdbId}`, 60_000, () => seerr()!.get<SeerrDetails>(`/api/v1/${type}/${tmdbId}`)).catch(() => undefined);
}

/** Library entries for this title in every Sonarr/Radarr instance. */
async function arrEntries(type: MediaType, tmdbId: number, tvdbId: number | undefined, can: (k: string) => boolean) {
  const out: { inst: ArrInstance; movie?: ArrMovie; series?: ArrSeries }[] = [];
  await Promise.all(
    arrInstances(type === 'movie' ? 'radarr' : 'sonarr')
      .filter((i) => can(i.kind))
      .map(async (inst) => {
        if (type === 'movie') {
          const list = await cache.get(`${inst.id}:movies`, 60_000, () => inst.client.get<ArrMovie[]>('/api/v3/movie')).catch(() => [] as ArrMovie[]);
          const m = list.find((x) => x.tmdbId === tmdbId);
          if (m) out.push({ inst, movie: m });
        } else {
          const list = await cache.get(`${inst.id}:series`, 60_000, () => inst.client.get<ArrSeries[]>('/api/v3/series')).catch(() => [] as ArrSeries[]);
          const s = list.find((x) => x.tmdbId === tmdbId || (tvdbId && x.tvdbId === tvdbId));
          if (s) out.push({ inst, series: s });
        }
      }),
  );
  return out.sort((a, b) => Number(b.inst.primary) - Number(a.inst.primary));
}

/** Radarr/Sonarr lookup, for metadata when Seerr isn't connected. */
async function arrLookup(type: MediaType, tmdbId: number) {
  const inst = arrInstances(type === 'movie' ? 'radarr' : 'sonarr')[0];
  if (!inst) return undefined;
  return cache
    .get(`${inst.id}:lookup:tmdb:${tmdbId}`, 60 * 60_000, async () => {
      if (type === 'movie') return inst.client.get<ArrMovie>('/api/v3/movie/lookup/tmdb', { tmdbId });
      const found = await inst.client.get<ArrSeries[]>('/api/v3/series/lookup', { term: `tmdb:${tmdbId}` });
      return found.find((s) => s.tmdbId === tmdbId) ?? found[0];
    })
    .catch(() => undefined);
}

function jellyfinUrl(itemId: string) {
  const base = resolve('jellyfin').settings.url;
  return base ? `${base}/web/#/details?id=${itemId}` : undefined;
}

export async function mediaDetails(ctx: JfCtx, type: MediaType, tmdbId: number, opts: { isAdmin: boolean; can: (area: string) => boolean }) {
  const [s, lib] = await Promise.all([seerrDetails(type, tmdbId), libraryItems(ctx).catch(() => [])]);
  const jfItem = lib.find((i) => i.tmdb === String(tmdbId) && i.type === (type === 'movie' ? 'Movie' : 'Series'));
  const arr = await arrEntries(type, tmdbId, s?.externalIds?.tvdbId, opts.can);
  const look = s ? undefined : await arrLookup(type, tmdbId);
  const firstArr = arr[0]?.movie ?? arr[0]?.series;
  const meta = (look ?? firstArr) as (ArrMovie & ArrSeries) | undefined;
  if (!s && !meta && !jfItem) throw new HttpError(404, 'StreamForge couldn’t find this title. Connect Seerr for full details of titles you don’t have yet.', 'not_found');

  const date = s?.releaseDate ?? s?.firstAirDate;
  const trailer = s?.relatedVideos?.find((v) => v.type === 'Trailer' && v.site === 'YouTube' && v.key) ?? undefined;
  const runtime = s?.runtime ?? s?.episodeRunTime?.[0] ?? meta?.runtime;

  // Season-by-season availability: Sonarr's files win, then Seerr's status.
  const sonarr = arr.find((a) => a.series)?.series;
  const seasonNumbers = new Set<number>([...(s?.seasons ?? []).map((x) => x.seasonNumber), ...(sonarr?.seasons ?? []).map((x) => x.seasonNumber)]);
  const requestedSeasons = new Set<number>();
  for (const r of s?.mediaInfo?.requests ?? []) if (r.status === 1 || r.status === 2) for (const x of r.seasons ?? []) requestedSeasons.add(x.seasonNumber);
  const seasons =
    type === 'tv'
      ? [...seasonNumbers]
          .filter((n) => n > 0)
          .sort((a, b) => a - b)
          .map((n) => {
            const sd = s?.seasons?.find((x) => x.seasonNumber === n);
            const st = sonarr?.seasons?.find((x) => x.seasonNumber === n)?.statistics;
            const ms = s?.mediaInfo?.seasons?.find((x) => x.seasonNumber === n)?.status;
            let status: Availability = 'none';
            if (st && st.episodeCount > 0) status = st.episodeFileCount >= st.episodeCount ? 'available' : st.episodeFileCount > 0 ? 'partial' : 'missing';
            else if (ms && MEDIA_STATUS[ms]) status = MEDIA_STATUS[ms]!;
            if ((status === 'none' || status === 'missing') && requestedSeasons.has(n)) status = 'requested';
            return {
              number: n,
              name: sd?.name ?? `Season ${n}`,
              episodes: sd?.episodeCount ?? st?.totalEpisodeCount,
              files: st?.episodeFileCount,
              airDate: sd?.airDate,
              status,
            };
          })
      : undefined;

  let availability: Availability = s?.mediaInfo?.status ? (MEDIA_STATUS[s.mediaInfo.status] ?? 'none') : 'none';
  if (jfItem && availability === 'none') availability = 'available';
  if (type === 'movie' && arr.some((a) => a.movie?.hasFile)) availability = 'available';
  if (type === 'movie' && availability === 'none' && arr.some((a) => a.movie?.monitored && !a.movie.hasFile)) availability = 'missing';
  if (type === 'tv' && seasons?.length) {
    const have = seasons.filter((x) => x.status === 'available').length;
    if (have === seasons.length) availability = 'available';
    else if (have > 0 || seasons.some((x) => x.status === 'partial')) availability = 'partial';
  }

  const canSeeRequests = opts.isAdmin || opts.can('seerr');
  let requests = (s?.mediaInfo?.requests ?? []).map((r) => ({
    id: r.id,
    status: REQUEST_STATUS[r.status] ?? 'unknown',
    requestedBy: r.requestedBy?.displayName ?? 'Someone',
    createdAt: r.createdAt,
    is4k: !!r.is4k,
    seasons: (r.seasons ?? []).map((x) => x.seasonNumber),
  }));
  if (!canSeeRequests) {
    // Members only see their own requests.
    const me = await seerrUserFor(ctx.userId).catch(() => undefined);
    requests = me ? requests.filter((r) => r.requestedBy === me.displayName) : [];
  }

  const canRequestArea = opts.isAdmin || opts.can('requests');
  const missingSeasons = seasons?.filter((x) => x.status === 'none' || x.status === 'missing').length ?? 0;
  return {
    type,
    tmdbId,
    title: s?.title ?? s?.name ?? meta?.title ?? jfItem?.name ?? 'Unknown title',
    year: date ? Number(date.slice(0, 4)) || undefined : (meta?.year ?? jfItem?.year),
    tagline: s?.tagline || undefined,
    overview: s?.overview ?? meta?.overview,
    genres: s?.genres?.map((g) => g.name) ?? meta?.genres ?? [],
    runtimeMin: runtime || undefined,
    rating: s?.voteAverage ? Math.round(s.voteAverage * 10) / 10 : (meta?.ratings?.tmdb?.value ?? meta?.ratings?.value),
    certification: meta?.certification,
    status: s?.status ?? meta?.status,
    network: s?.networks?.[0]?.name ?? s?.productionCompanies?.[0]?.name ?? meta?.network ?? meta?.studio,
    releaseDate: date,
    poster: s?.posterPath ? `${TMDB}/w500${s.posterPath}` : (remote(meta?.images, 'poster') ?? (jfItem ? `/api/jellyfin/image/items/${jfItem.id}/Primary?w=500` : undefined)),
    backdrop: s?.backdropPath ? `${TMDB}/w1280${s.backdropPath}` : (remote(meta?.images, 'fanart') ?? (jfItem ? `/api/jellyfin/image/items/${jfItem.id}/Backdrop?w=1600` : undefined)),
    trailer: trailer ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key!)}` : meta?.youTubeTrailerId ? `https://www.youtube.com/watch?v=${encodeURIComponent(meta.youTubeTrailerId)}` : undefined,
    cast: (s?.credits?.cast ?? []).slice(0, 16).map((c) => ({ name: c.name, character: c.character, image: c.profilePath ? `${TMDB}/w185${c.profilePath}` : undefined })),
    seasons,
    availability,
    jellyfin: jfItem ? { itemId: jfItem.id, url: jellyfinUrl(jfItem.id) } : undefined,
    arr: arr.map(({ inst, movie, series }) => ({
      kind: inst.kind,
      instance: inst.id,
      instanceName: inst.primary ? inst.name : `${inst.name}`,
      primary: inst.primary,
      id: (movie?.id ?? series?.id)!,
      monitored: !!(movie?.monitored ?? series?.monitored),
      downloaded: movie ? !!movie.hasFile : (series?.statistics?.episodeFileCount ?? 0) > 0,
      files: series?.statistics?.episodeFileCount,
      total: series?.statistics?.episodeCount,
      sizeOnDisk: movie?.sizeOnDisk ?? series?.statistics?.sizeOnDisk ?? 0,
      quality: movie?.movieFile?.quality?.quality?.name,
      path: opts.isAdmin ? (movie?.path ?? series?.path) : undefined,
      poster: coverUrl(inst, (movie ?? series)?.images),
    })),
    requests,
    can: {
      request: canRequestArea && isConfigured('seerr') && (type === 'movie' ? availability === 'none' || availability === 'missing' : missingSeasons > 0 || availability === 'none'),
      add: opts.isAdmin && arr.length === 0 && arrInstances(type === 'movie' ? 'radarr' : 'sonarr').length > 0,
      search: opts.isAdmin && arr.length > 0,
      approve: opts.isAdmin && isConfigured('seerr'),
    },
    sources: { seerr: !!s, jellyfin: !!jfItem },
  };
}

/* ------------------------- Jellyfin item → details ------------------------- */

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesId?: string;
  SeriesName?: string;
  ProductionYear?: number;
  Overview?: string;
  Genres?: string[];
  RunTimeTicks?: number;
  CommunityRating?: number;
  OfficialRating?: string;
  ProviderIds?: Record<string, string>;
  ImageTags?: { Primary?: string };
  BackdropImageTags?: string[];
  People?: { Name: string; Role?: string; Type?: string; Id: string; PrimaryImageTag?: string }[];
}

/**
 * Resolves a Jellyfin item (a movie, series, season or episode) to a title.
 * With a TMDB id the page switches to the full details; otherwise (home
 * videos, unidentified items) it shows what Jellyfin knows.
 */
export async function jellyfinMedia(ctx: JfCtx, itemId: string) {
  const get = (id: string) =>
    jf<{ Items: JfItem[] }>('/Items', ctx.token, ctx.deviceId, { userId: ctx.userId, ids: id, Fields: 'ProviderIds,Overview,Genres,People,OfficialRating' }).then((r) => r.Items?.[0]);
  let item = await get(itemId);
  if (!item) throw new HttpError(404, 'Jellyfin doesn’t have this item (or you can’t see it).', 'not_found');
  if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId) item = (await get(item.SeriesId)) ?? item;
  const tmdb = Number(item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb);
  const type: MediaType | undefined = item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'tv' : undefined;
  if (type && tmdb > 0) return { redirect: { type, tmdbId: tmdb } };
  return {
    jellyfinOnly: {
      itemId: item.Id,
      title: item.Name,
      kind: item.Type,
      year: item.ProductionYear,
      overview: item.Overview,
      genres: item.Genres ?? [],
      runtimeMin: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MS / 60_000) : undefined,
      rating: item.CommunityRating,
      certification: item.OfficialRating,
      poster: item.ImageTags?.Primary ? `/api/jellyfin/image/items/${item.Id}/Primary?w=500&tag=${item.ImageTags.Primary}` : undefined,
      backdrop: item.BackdropImageTags?.[0] ? `/api/jellyfin/image/items/${item.Id}/Backdrop?w=1600&tag=${item.BackdropImageTags[0]}` : undefined,
      cast: (item.People ?? [])
        .filter((p) => p.Type === 'Actor')
        .slice(0, 16)
        .map((p) => ({ name: p.Name, character: p.Role, image: p.PrimaryImageTag ? `/api/jellyfin/image/items/${p.Id}/Primary?w=185&tag=${p.PrimaryImageTag}` : undefined })),
      url: jellyfinUrl(item.Id),
    },
  };
}

/** Starts a search in Radarr (one movie) or Sonarr (a whole series). */
export async function arrTitleSearch(kind: 'radarr' | 'sonarr', instanceId: string, id: number) {
  const inst = arrInstances(kind).find((i) => i.id === instanceId);
  if (!inst) throw new HttpError(404, 'Unknown instance', 'not_configured');
  const body = kind === 'radarr' ? { name: 'MoviesSearch', movieIds: [id] } : { name: 'SeriesSearch', seriesId: id };
  await inst.client.post('/api/v3/command', body);
  return { ok: true, instance: inst.name };
}

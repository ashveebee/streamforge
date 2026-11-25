import { cache } from '../lib/cache.js';
import { HttpError } from '../lib/handle.js';
import { isConfigured, publicUrl } from '../settings.js';
import { coverUrl } from './arr.js';
import { arrInstances, type ArrInstance } from './instances.js';
import { jf, libraryItems, type JfCtx } from './jellyfin.js';
import { allLibraryItems, idKeys, notJellyfinMain, openLink, type LibraryEntry } from './mainServer.js';
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
  const base = publicUrl('jellyfin');
  return base ? `${base}/web/#/details?id=${itemId}` : undefined;
}

export async function mediaDetails(ctx: JfCtx, type: MediaType, tmdbId: number, opts: { isAdmin: boolean; can: (area: string) => boolean }) {
  // Title pages read Jellyfin's library for full details; every server is checked for where it's available.
  const [s, lib, everywhere] = await Promise.all([
    seerrDetails(type, tmdbId),
    notJellyfinMain() ? [] : libraryItems(ctx).catch(() => []),
    allLibraryItems(ctx).catch(() => ({ items: [] as LibraryEntry[] })),
  ]);
  const jfItem = lib.find((i) => i.tmdb === String(tmdbId) && i.type === (type === 'movie' ? 'Movie' : 'Series'));
  const [arr, library] = await Promise.all([
    arrEntries(type, tmdbId, s?.externalIds?.tvdbId, opts.can),
    jfItem ? jellyfinLibrary(ctx, jfItem.id, opts.isAdmin).catch(() => undefined) : undefined,
  ]);
  const look = s ? undefined : await arrLookup(type, tmdbId);
  const firstArr = arr[0]?.movie ?? arr[0]?.series;
  const meta = (look ?? firstArr) as (ArrMovie & ArrSeries) | undefined;
  // Every server that has the title, matched by TMDB id (and TVDB/IMDb when Seerr knows them).
  const wanted = new Set(idKeys({ tmdb: tmdbId, tvdb: s?.externalIds?.tvdbId, imdb: s?.externalIds?.imdbId }));
  const kind = type === 'movie' ? 'Movie' : 'Series';
  const availableOn = everywhere.items
    .filter((i) => i.type === kind && idKeys(i).some((k) => wanted.has(k)))
    .filter((i, n, all) => all.findIndex((x) => x.server.id === i.server.id) === n)
    .sort((a, b) => Number(b.server.main) - Number(a.server.main) || a.server.name.localeCompare(b.server.name))
    .map((i) => ({ server: i.server.id, type: i.server.type, name: i.server.name, main: i.server.main, itemId: i.id, url: openLink(i.server, i.id) }));
  if (!s && !meta && !jfItem && !availableOn.length) throw new HttpError(404, 'StreamForge couldn’t find this title. Connect Seerr for full details of titles you don’t have yet.', 'not_found');

  const date = s?.releaseDate ?? s?.firstAirDate;
  const trailer = s?.relatedVideos?.find((v) => v.type === 'Trailer' && v.site === 'YouTube' && v.key) ?? undefined;
  const runtime = s?.runtime ?? s?.episodeRunTime?.[0] ?? meta?.runtime;

  // Season-by-season availability: Sonarr's files win, then Seerr's status.
  const sonarr = arr.find((a) => a.series)?.series;
  const jfSeasons = library?.seasons ?? [];
  const seasonNumbers = new Set<number>([
    ...(s?.seasons ?? []).map((x) => x.seasonNumber),
    ...(sonarr?.seasons ?? []).map((x) => x.seasonNumber),
    ...jfSeasons.map((x) => x.number),
  ]);
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
            const js = jfSeasons.find((x) => x.number === n);
            const episodes = sd?.episodeCount ?? st?.totalEpisodeCount;
            let status: Availability = 'none';
            if (st && st.episodeCount > 0) status = st.episodeFileCount >= st.episodeCount ? 'available' : st.episodeFileCount > 0 ? 'partial' : 'missing';
            else if (ms && MEDIA_STATUS[ms]) status = MEDIA_STATUS[ms]!;
            else if (js?.episodes) status = episodes && js.episodes < episodes ? 'partial' : 'available';
            if ((status === 'none' || status === 'missing') && requestedSeasons.has(n)) status = 'requested';
            return {
              number: n,
              name: sd?.name ?? `Season ${n}`,
              episodes,
              files: st?.episodeFileCount ?? js?.episodes,
              airDate: sd?.airDate,
              status,
              jellyfin: js ? { id: js.id, episodes: js.episodes, unplayed: js.unplayed } : undefined,
            };
          })
      : undefined;

  let availability: Availability = s?.mediaInfo?.status ? (MEDIA_STATUS[s.mediaInfo.status] ?? 'none') : 'none';
  if ((jfItem || availableOn.length) && availability === 'none') availability = 'available';
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
    tagline: s?.tagline || library?.tagline,
    overview: s?.overview || meta?.overview || library?.overview,
    genres: s?.genres?.map((g) => g.name) ?? meta?.genres ?? library?.genres ?? [],
    runtimeMin: runtime || undefined,
    rating: s?.voteAverage ? Math.round(s.voteAverage * 10) / 10 : (meta?.ratings?.tmdb?.value ?? meta?.ratings?.value),
    certification: meta?.certification ?? library?.certification,
    status: s?.status ?? meta?.status,
    network: s?.networks?.[0]?.name ?? s?.productionCompanies?.[0]?.name ?? meta?.network ?? meta?.studio,
    releaseDate: date,
    poster: s?.posterPath ? `${TMDB}/w500${s.posterPath}` : (remote(meta?.images, 'poster') ?? (jfItem ? `/api/jellyfin/image/items/${jfItem.id}/Primary?w=500` : undefined)),
    backdrop: s?.backdropPath ? `${TMDB}/w1280${s.backdropPath}` : (remote(meta?.images, 'fanart') ?? (jfItem ? `/api/jellyfin/image/items/${jfItem.id}/Backdrop?w=1600` : undefined)),
    trailer: trailer ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key!)}` : meta?.youTubeTrailerId ? `https://www.youtube.com/watch?v=${encodeURIComponent(meta.youTubeTrailerId)}` : undefined,
    cast: s?.credits?.cast?.length
      ? s.credits.cast.slice(0, 20).map((c) => ({ name: c.name, character: c.character, image: c.profilePath ? `${TMDB}/w185${c.profilePath}` : undefined }))
      : (library?.cast ?? []),
    seasons,
    availability,
    jellyfin: jfItem ? { itemId: jfItem.id, url: jellyfinUrl(jfItem.id) } : undefined,
    /** Every media server the title is on, the sign-in server first. */
    availableOn,
    library: library ? { ...library, seasons: undefined, cast: undefined, overview: undefined, tagline: undefined, genres: undefined, certification: undefined } : undefined,
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

const ticksToMin = (t?: number) => (t ? Math.round(t / TICKS_PER_MS / 60_000) : undefined);
const jfImage = (id: string, type: string, tag: string | undefined, w: number) => (tag ? `/api/jellyfin/image/items/${id}/${type}?w=${w}&tag=${tag}` : undefined);

interface JfStream {
  Type: string;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  Width?: number;
  Height?: number;
  BitRate?: number;
  BitDepth?: number;
  Channels?: number;
  ChannelLayout?: string;
  RealFrameRate?: number;
  AverageFrameRate?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsHearingImpaired?: boolean;
}
interface JfSource {
  Id: string;
  Name?: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  MediaStreams?: JfStream[];
}
interface JfUserData {
  Played?: boolean;
  PlayCount?: number;
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  LastPlayedDate?: string;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
}
interface JfItem {
  Id: string;
  Name: string;
  OriginalTitle?: string;
  Type: string;
  SeriesId?: string;
  SeriesName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  EndDate?: string;
  DateCreated?: string;
  Overview?: string;
  Taglines?: string[];
  Genres?: string[];
  Tags?: string[];
  Studios?: { Name: string }[];
  RunTimeTicks?: number;
  CommunityRating?: number;
  CriticRating?: number;
  OfficialRating?: string;
  Status?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
  Path?: string;
  ProviderIds?: Record<string, string>;
  ImageTags?: { Primary?: string; Thumb?: string; Logo?: string };
  BackdropImageTags?: string[];
  People?: { Name: string; Role?: string; Type?: string; Id: string; PrimaryImageTag?: string }[];
  MediaSources?: JfSource[];
  UserData?: JfUserData;
  LocationType?: string;
}

const FIELDS = 'ProviderIds,Overview,Genres,Tags,Studios,People,OfficialRating,Taglines,DateCreated,Path,MediaSources,ChildCount,RecursiveItemCount,CriticRating,OriginalTitle,Status,EndDate';

const getItem = (ctx: JfCtx, id: string) =>
  jf<{ Items: JfItem[] }>('/Items', ctx.token, ctx.deviceId, { userId: ctx.userId, ids: id, Fields: FIELDS }).then((r) => r.Items?.[0]);

function resolution(w?: number, h?: number) {
  if (!w || !h) return undefined;
  if (w >= 3800 || h >= 2100) return '4K';
  if (w >= 2500 || h >= 1400) return '1440p';
  if (w >= 1900 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  if (h >= 560) return '576p';
  return `${h}p`;
}

const channelLabel = (c?: number, layout?: string) => layout ?? (c === 8 ? '7.1' : c === 6 ? '5.1' : c === 2 ? 'Stereo' : c === 1 ? 'Mono' : c ? `${c} ch` : undefined);

/** One file (a "version" in Jellyfin): container, size and its streams. */
function fileInfo(src: JfSource, isAdmin: boolean) {
  const streams = src.MediaStreams ?? [];
  const v = streams.find((x) => x.Type === 'Video');
  const range = v?.VideoRangeType && v.VideoRangeType !== 'SDR' ? v.VideoRangeType : v?.VideoRange && v.VideoRange !== 'SDR' ? v.VideoRange : undefined;
  return {
    id: src.Id,
    name: src.Name,
    container: src.Container,
    size: src.Size,
    bitrate: src.Bitrate,
    path: isAdmin ? src.Path : undefined,
    video: v
      ? {
          codec: v.Codec?.toUpperCase(),
          resolution: resolution(v.Width, v.Height),
          width: v.Width,
          height: v.Height,
          range,
          bitDepth: v.BitDepth,
          fps: v.RealFrameRate ?? v.AverageFrameRate ? Math.round((v.RealFrameRate ?? v.AverageFrameRate)! * 100) / 100 : undefined,
          bitrate: v.BitRate,
        }
      : undefined,
    audio: streams
      .filter((x) => x.Type === 'Audio')
      .map((a) => ({ title: a.DisplayTitle ?? a.Title, language: a.Language, codec: a.Codec?.toUpperCase(), channels: channelLabel(a.Channels, a.ChannelLayout), isDefault: !!a.IsDefault })),
    subtitles: streams
      .filter((x) => x.Type === 'Subtitle')
      .map((t) => ({ title: t.DisplayTitle ?? t.Title, language: t.Language, codec: t.Codec?.toUpperCase(), forced: !!t.IsForced, external: !!t.IsExternal, sdh: !!t.IsHearingImpaired, isDefault: !!t.IsDefault })),
  };
}

function watchState(u: JfUserData | undefined, runtimeTicks?: number) {
  if (!u) return undefined;
  const progress = u.PlayedPercentage ?? (u.PlaybackPositionTicks && runtimeTicks ? (u.PlaybackPositionTicks / runtimeTicks) * 100 : undefined);
  return {
    played: !!u.Played,
    playCount: u.PlayCount ?? 0,
    lastPlayed: u.LastPlayedDate,
    favorite: !!u.IsFavorite,
    progress: progress && progress > 0 && progress < 100 ? Math.round(progress) : undefined,
    remainingMin: u.PlaybackPositionTicks && runtimeTicks ? ticksToMin(runtimeTicks - u.PlaybackPositionTicks) : undefined,
    unplayed: u.UnplayedItemCount,
  };
}

const PROVIDER_LINKS: [key: string, label: string, url: (id: string, tv: boolean) => string][] = [
  ['Imdb', 'IMDb', (id) => `https://www.imdb.com/title/${id}`],
  ['Tmdb', 'TMDB', (id, tv) => `https://www.themoviedb.org/${tv ? 'tv' : 'movie'}/${id}`],
  ['Tvdb', 'TheTVDB', (id, tv) => `https://www.thetvdb.com/dereferrer/${tv ? 'series' : 'movie'}/${id}`],
  ['Trakt', 'Trakt', (id, tv) => `https://trakt.tv/${tv ? 'shows' : 'movies'}/${id}`],
];

function episodeOf(e: JfItem, isAdmin: boolean) {
  const src = e.MediaSources?.[0];
  const v = src?.MediaStreams?.find((x) => x.Type === 'Video');
  return {
    id: e.Id,
    season: e.ParentIndexNumber,
    number: e.IndexNumber,
    name: e.Name,
    overview: e.Overview,
    airDate: e.PremiereDate,
    runtimeMin: ticksToMin(e.RunTimeTicks),
    rating: e.CommunityRating ? Math.round(e.CommunityRating * 10) / 10 : undefined,
    still: jfImage(e.Id, 'Primary', e.ImageTags?.Primary, 400),
    resolution: resolution(v?.Width, v?.Height),
    size: src?.Size,
    path: isAdmin ? (src?.Path ?? e.Path) : undefined,
    missing: e.LocationType === 'Virtual',
    watch: watchState(e.UserData, e.RunTimeTicks),
    url: jellyfinUrl(e.Id),
  };
}

/**
 * What Jellyfin itself knows about a movie or series in the library: files
 * and streams, the signed-in user's watch state, crew, studios, tags,
 * external links and, for series, the seasons it has and what's next up.
 */
export async function jellyfinLibrary(ctx: JfCtx, itemId: string, isAdmin: boolean, preloaded?: JfItem) {
  return cache.get(`jf:library:${ctx.userId}:${itemId}:${isAdmin ? 1 : 0}`, 30_000, async () => {
    const item = preloaded ?? (await getItem(ctx, itemId));
    if (!item) throw new HttpError(404, 'Jellyfin doesn’t have this item (or you can’t see it).', 'not_found');
    const tv = item.Type === 'Series';
    const [seasons, nextUp] = tv
      ? await Promise.all([
          jf<{ Items: JfItem[] }>(`/Shows/${item.Id}/Seasons`, ctx.token, ctx.deviceId, { userId: ctx.userId, Fields: 'ChildCount', isMissing: false }).then((r) => r.Items ?? []).catch(() => [] as JfItem[]),
          jf<{ Items: JfItem[] }>('/Shows/NextUp', ctx.token, ctx.deviceId, { userId: ctx.userId, seriesId: item.Id, Fields: 'MediaSources,Overview', limit: 1 }).then((r) => r.Items?.[0]).catch(() => undefined),
        ])
      : [[] as JfItem[], undefined];
    const people = item.People ?? [];
    const crew = (type: string) => [...new Set(people.filter((p) => p.Type === type).map((p) => p.Name))].slice(0, 6);
    const ids = item.ProviderIds ?? {};
    const providerIds = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      itemId: item.Id,
      kind: item.Type,
      url: jellyfinUrl(item.Id),
      originalTitle: item.OriginalTitle && item.OriginalTitle !== item.Name ? item.OriginalTitle : undefined,
      overview: item.Overview,
      tagline: item.Taglines?.[0],
      genres: item.Genres,
      certification: item.OfficialRating,
      added: item.DateCreated,
      premiered: item.PremiereDate,
      ended: tv && item.Status === 'Ended' ? item.EndDate : undefined,
      seriesStatus: tv ? item.Status : undefined,
      communityRating: item.CommunityRating ? Math.round(item.CommunityRating * 10) / 10 : undefined,
      criticRating: item.CriticRating,
      runtimeMin: ticksToMin(item.RunTimeTicks),
      path: isAdmin ? item.Path : undefined,
      directors: crew('Director'),
      writers: crew('Writer'),
      producers: crew('Producer'),
      studios: (item.Studios ?? []).map((x) => x.Name).slice(0, 6),
      tags: (item.Tags ?? []).slice(0, 12),
      links: PROVIDER_LINKS.filter(([k]) => providerIds[k.toLowerCase()]).map(([k, label, url]) => ({ label, url: url(providerIds[k.toLowerCase()]!, tv) })),
      watch: watchState(item.UserData, item.RunTimeTicks),
      files: (item.MediaSources ?? []).map((src) => fileInfo(src, isAdmin)),
      episodeCount: tv ? item.RecursiveItemCount : undefined,
      seasonCount: tv ? seasons.length : undefined,
      seasons: seasons
        .filter((x) => typeof x.IndexNumber === 'number')
        .map((x) => ({ id: x.Id, number: x.IndexNumber!, name: x.Name, episodes: x.ChildCount ?? 0, unplayed: x.UserData?.UnplayedItemCount })),
      nextUp: nextUp ? episodeOf(nextUp, isAdmin) : undefined,
      cast: people
        .filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar')
        .slice(0, 20)
        .map((p) => ({ name: p.Name, character: p.Role, image: jfImage(p.Id, 'Primary', p.PrimaryImageTag, 185) })),
    };
  });
}

export type JellyfinLibrary = Awaited<ReturnType<typeof jellyfinLibrary>>;

/** The episodes Jellyfin has for one season of a series. */
export async function jellyfinEpisodes(ctx: JfCtx, seriesId: string, seasonId: string, isAdmin: boolean) {
  const res = await jf<{ Items: JfItem[] }>(`/Shows/${seriesId}/Episodes`, ctx.token, ctx.deviceId, {
    userId: ctx.userId,
    seasonId,
    Fields: 'Overview,MediaSources,Path',
    isMissing: false,
  });
  return { episodes: (res.Items ?? []).map((e) => episodeOf(e, isAdmin)) };
}

/* ------------------------- every episode of a season ------------------------ */

interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  overview?: string;
  airDateUtc?: string;
  runtime?: number;
  hasFile?: boolean;
  monitored?: boolean;
  images?: ArrImage[];
  episodeFile?: {
    size?: number;
    path?: string;
    quality?: { quality?: { name?: string } };
    mediaInfo?: { videoCodec?: string; audioCodec?: string; audioChannels?: number; resolution?: string; videoDynamicRangeType?: string; subtitles?: string; audioLanguages?: string };
  };
}
interface SeerrSeason {
  episodes?: { episodeNumber: number; name?: string; overview?: string; airDate?: string; stillPath?: string; voteAverage?: number }[];
}

export type EpisodeStatus = 'available' | 'missing' | 'unaired' | 'unmonitored';

/**
 * Every episode of one season, including the ones you don't have: titles and
 * stills from Seerr (TMDB), files and monitoring from Sonarr, watch state and
 * playback from Jellyfin, merged by episode number.
 */
export async function seasonEpisodes(ctx: JfCtx, tmdbId: number, season: number, opts: { isAdmin: boolean; can: (area: string) => boolean }) {
  const [s, lib] = await Promise.all([seerrDetails('tv', tmdbId), notJellyfinMain() ? [] : libraryItems(ctx).catch(() => [])]);
  const jfItem = lib.find((i) => i.tmdb === String(tmdbId) && i.type === 'Series');
  const arr = await arrEntries('tv', tmdbId, s?.externalIds?.tvdbId, opts.can);
  const sonarr = arr.find((a) => a.series);
  const [tmdb, son, jfe] = await Promise.all([
    isConfigured('seerr')
      ? cache.get(`seerr:season:${tmdbId}:${season}`, 10 * 60_000, () => seerr()!.get<SeerrSeason>(`/api/v1/tv/${tmdbId}/season/${season}`)).catch(() => undefined)
      : undefined,
    sonarr
      ? cache
          .get(`${sonarr.inst.id}:episodes:${sonarr.series!.id}:${season}`, 30_000, () =>
            sonarr.inst.client.get<SonarrEpisode[]>('/api/v3/episode', { seriesId: sonarr.series!.id!, seasonNumber: season, includeEpisodeFile: true, includeImages: true }),
          )
          .catch(() => [] as SonarrEpisode[])
      : ([] as SonarrEpisode[]),
    jfItem
      ? jf<{ Items: JfItem[] }>(`/Shows/${jfItem.id}/Episodes`, ctx.token, ctx.deviceId, { userId: ctx.userId, season, Fields: 'Overview,MediaSources,Path', isMissing: false })
          .then((r) => (r.Items ?? []).filter((e) => e.LocationType !== 'Virtual'))
          .catch(() => [] as JfItem[])
      : ([] as JfItem[]),
  ]);
  const numbers = new Set<number>([
    ...(tmdb?.episodes ?? []).map((e) => e.episodeNumber),
    ...son.map((e) => e.episodeNumber),
    ...jfe.filter((e) => e.IndexNumber !== undefined).map((e) => e.IndexNumber!),
  ]);
  const now = Date.now();
  const episodes = [...numbers]
    .sort((a, b) => a - b)
    .map((n) => {
      const t = tmdb?.episodes?.find((e) => e.episodeNumber === n);
      const so = son.find((e) => e.episodeNumber === n);
      const j = jfe.find((e) => e.IndexNumber === n);
      const jfEp = j ? episodeOf(j, opts.isAdmin) : undefined;
      const airDate = t?.airDate ?? so?.airDateUtc ?? jfEp?.airDate;
      const have = !!j || !!so?.hasFile;
      const status: EpisodeStatus = have ? 'available' : airDate && Date.parse(airDate) > now ? 'unaired' : so && !so.monitored ? 'unmonitored' : 'missing';
      const mi = so?.episodeFile?.mediaInfo;
      const file = j?.MediaSources?.[0] ? fileInfo(j.MediaSources[0], opts.isAdmin) : undefined;
      return {
        number: n,
        season,
        name: t?.name || so?.title || j?.Name || `Episode ${n}`,
        overview: t?.overview || so?.overview || j?.Overview,
        airDate,
        runtimeMin: jfEp?.runtimeMin ?? so?.runtime ?? undefined,
        rating: t?.voteAverage ? Math.round(t.voteAverage * 10) / 10 : jfEp?.rating,
        still: jfEp?.still ?? (t?.stillPath ? `${TMDB}/w400${t.stillPath}` : remote(so?.images, 'screenshot')),
        status,
        monitored: so?.monitored,
        quality: so?.episodeFile?.quality?.quality?.name,
        size: so?.episodeFile?.size ?? file?.size,
        path: opts.isAdmin ? (so?.episodeFile?.path ?? file?.path) : undefined,
        /** From Jellyfin when it has the file, else Sonarr's media info. */
        file:
          file ??
          (mi
            ? {
                id: `sonarr-${so!.id}`,
                container: undefined,
                size: so?.episodeFile?.size,
                video: { codec: mi.videoCodec?.toUpperCase(), resolution: mi.resolution, range: mi.videoDynamicRangeType || undefined },
                audio: (mi.audioLanguages ?? '').split('/').filter(Boolean).map((l, i) => ({ title: l.trim(), codec: i === 0 ? mi.audioCodec : undefined, channels: i === 0 && mi.audioChannels ? String(mi.audioChannels) : undefined, isDefault: i === 0 })),
                subtitles: (mi.subtitles ?? '').split('/').filter(Boolean).map((l) => ({ title: l.trim(), forced: false, external: false, sdh: false, isDefault: false })),
              }
            : undefined),
        jellyfin: jfEp ? { id: jfEp.id, url: jfEp.url, watch: jfEp.watch } : undefined,
        sonarr: so && opts.isAdmin ? { instance: sonarr!.inst.id, episodeId: so.id } : undefined,
      };
    });
  return {
    season,
    episodes,
    counts: {
      total: episodes.length,
      available: episodes.filter((e) => e.status === 'available').length,
      missing: episodes.filter((e) => e.status === 'missing').length,
      unaired: episodes.filter((e) => e.status === 'unaired').length,
    },
    sources: { tmdb: !!tmdb, sonarr: !!sonarr, jellyfin: !!jfItem },
    sonarr: sonarr && opts.isAdmin ? { instance: sonarr.inst.id, seriesId: sonarr.series!.id! } : undefined,
  };
}

/**
 * Resolves a Jellyfin item (a movie, series, season or episode) to a title.
 * With a TMDB id the page switches to the full details; otherwise (home
 * videos, unidentified items) it shows what Jellyfin knows.
 */
export async function jellyfinMedia(ctx: JfCtx, itemId: string, isAdmin: boolean) {
  let item = await getItem(ctx, itemId);
  if (!item) throw new HttpError(404, 'Jellyfin doesn’t have this item (or you can’t see it).', 'not_found');
  if ((item.Type === 'Episode' || item.Type === 'Season') && item.SeriesId) item = (await getItem(ctx, item.SeriesId)) ?? item;
  const tmdb = Number(item.ProviderIds?.Tmdb ?? item.ProviderIds?.tmdb);
  const type: MediaType | undefined = item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'tv' : undefined;
  if (type && tmdb > 0) return { redirect: { type, tmdbId: tmdb } };
  const library = await jellyfinLibrary(ctx, item.Id, isAdmin, item);
  return {
    jellyfinOnly: {
      itemId: item.Id,
      title: item.Name,
      kind: item.Type,
      year: item.ProductionYear,
      tagline: library.tagline,
      overview: item.Overview,
      genres: item.Genres ?? [],
      runtimeMin: ticksToMin(item.RunTimeTicks),
      rating: item.CommunityRating,
      certification: item.OfficialRating,
      poster: jfImage(item.Id, 'Primary', item.ImageTags?.Primary, 500),
      backdrop: jfImage(item.Id, 'Backdrop', item.BackdropImageTags?.[0], 1600),
      cast: library.cast,
      url: jellyfinUrl(item.Id),
      seasons: library.seasons,
      library: { ...library, seasons: undefined, cast: undefined },
    },
  };
}

/**
 * Starts a search in Radarr (one movie) or Sonarr (a whole series, one
 * season, or specific episodes).
 */
export async function arrTitleSearch(kind: 'radarr' | 'sonarr', instanceId: string, id: number, scope?: { season?: number; episodeIds?: number[] }) {
  const inst = arrInstances(kind).find((i) => i.id === instanceId);
  if (!inst) throw new HttpError(404, 'Unknown instance', 'not_configured');
  const body =
    kind === 'radarr'
      ? { name: 'MoviesSearch', movieIds: [id] }
      : scope?.episodeIds?.length
        ? { name: 'EpisodeSearch', episodeIds: scope.episodeIds }
        : scope?.season !== undefined
          ? { name: 'SeasonSearch', seriesId: id, seasonNumber: scope.season }
          : { name: 'SeriesSearch', seriesId: id };
  await inst.client.post('/api/v3/command', body);
  return { ok: true, instance: inst.name };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type MediaType = 'movie' | 'tv';
export type Availability = 'available' | 'partial' | 'processing' | 'requested' | 'missing' | 'none';

export interface CastMember {
  name: string;
  character?: string;
  image?: string;
}

export interface WatchState {
  played: boolean;
  playCount: number;
  lastPlayed?: string;
  favorite: boolean;
  /** Percent watched, when part way through. */
  progress?: number;
  remainingMin?: number;
  /** Series and seasons: episodes not watched yet. */
  unplayed?: number;
}

export interface MediaFile {
  id: string;
  /** Set when copies from several servers are shown together. */
  serverType?: 'jellyfin' | 'plex' | 'emby' | 'silo';
  name?: string;
  container?: string;
  size?: number;
  /** Bits per second. */
  bitrate?: number;
  path?: string;
  video?: { codec?: string; resolution?: string; width?: number; height?: number; range?: string; bitDepth?: number; fps?: number; bitrate?: number };
  audio: { title?: string; language?: string; codec?: string; channels?: string; isDefault: boolean }[];
  subtitles: { title?: string; language?: string; codec?: string; forced: boolean; external: boolean; sdh: boolean; isDefault: boolean }[];
}

export interface Episode {
  id: string;
  season?: number;
  number?: number;
  name: string;
  overview?: string;
  airDate?: string;
  runtimeMin?: number;
  rating?: number;
  still?: string;
  resolution?: string;
  size?: number;
  path?: string;
  missing: boolean;
  watch?: WatchState;
  url?: string;
}

/** What Jellyfin knows about a title in your library. */
export interface LibraryInfo {
  itemId: string;
  kind: string;
  url?: string;
  originalTitle?: string;
  added?: string;
  premiered?: string;
  ended?: string;
  seriesStatus?: string;
  communityRating?: number;
  criticRating?: number;
  runtimeMin?: number;
  path?: string;
  directors: string[];
  writers: string[];
  producers: string[];
  studios: string[];
  tags: string[];
  links: { label: string; url: string }[];
  watch?: WatchState;
  files: MediaFile[];
  episodeCount?: number;
  seasonCount?: number;
  nextUp?: Episode;
}

export interface Season {
  number: number;
  name: string;
  episodes?: number;
  files?: number;
  airDate?: string;
  status: Availability;
  jellyfin?: { id: string; episodes: number; unplayed?: number };
}

/** A media server a title is on, with a link to open it there. */
export interface AvailableOn {
  server: string;
  type: 'jellyfin' | 'plex' | 'emby' | 'silo';
  name: string;
  /** The sign-in server. */
  main: boolean;
  itemId: string;
  url?: string;
  /** A movie's copies on this server. */
  files?: MediaFile[];
  /** When it was added to this server. */
  added?: string;
  /** Plays StreamForge knows of on this server (admins). */
  plays?: number;
}

/** Someone who has watched the title, and where (admins). */
export interface TitleWatcher {
  user: string;
  at: string;
  plays: number;
  serverId?: string;
  serverName?: string;
  serverType?: 'jellyfin' | 'plex' | 'emby' | 'silo';
  client?: string;
  device?: string;
  watchedMs?: number;
  source: 'recorded' | 'server';
}

export interface MediaDetails {
  /** Every media server StreamForge knows, so the page can say where the title isn't. */
  servers?: { id: string; name: string; type: 'jellyfin' | 'plex' | 'emby' | 'silo'; main: boolean }[];
  watchers?: TitleWatcher[];
  /** Every media server the title is on, the sign-in server first. */
  availableOn?: AvailableOn[];
  type: MediaType;
  tmdbId: number;
  title: string;
  year?: number;
  tagline?: string;
  overview?: string;
  genres: string[];
  runtimeMin?: number;
  rating?: number;
  certification?: string;
  status?: string;
  network?: string;
  releaseDate?: string;
  poster?: string;
  backdrop?: string;
  trailer?: string;
  cast: CastMember[];
  seasons?: Season[];
  availability: Availability;
  jellyfin?: { itemId: string; url?: string };
  library?: LibraryInfo;
  arr: {
    kind: 'radarr' | 'sonarr';
    instance: string;
    instanceName: string;
    primary: boolean;
    id: number;
    monitored: boolean;
    downloaded: boolean;
    files?: number;
    total?: number;
    sizeOnDisk: number;
    quality?: string;
    path?: string;
  }[];
  requests: { id: number; status: string; requestedBy: string; createdAt: string; is4k: boolean; seasons: number[] }[];
  can: { request: boolean; add: boolean; search: boolean; approve: boolean };
  sources: { seerr: boolean; jellyfin: boolean };
  /** More like this: TMDb recommendations from Silo or Seerr. */
  similar?: SimilarTitle[];
}

export interface SimilarTitle {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string;
  status: 'available' | 'partial' | 'requested' | 'none';
}

export interface JellyfinOnly {
  itemId: string;
  title: string;
  kind: string;
  year?: number;
  tagline?: string;
  overview?: string;
  genres: string[];
  runtimeMin?: number;
  rating?: number;
  certification?: string;
  poster?: string;
  backdrop?: string;
  cast: CastMember[];
  url?: string;
  seasons: { id: string; number: number; name: string; episodes: number; unplayed?: number }[];
  library: LibraryInfo;
}

export const useMediaDetails = (type: MediaType, tmdbId: number) =>
  useQuery({ queryKey: ['media', type, tmdbId], queryFn: ({ signal }) => api<MediaDetails>(`/media/${type}/${tmdbId}`, { signal }), enabled: tmdbId > 0, refetchInterval: 30_000 });

export const useJellyfinMedia = (itemId: string) =>
  useQuery({
    queryKey: ['media', 'jellyfin', itemId],
    queryFn: ({ signal }) => api<{ redirect?: { type: MediaType; tmdbId: number }; jellyfinOnly?: JellyfinOnly }>(`/media/jellyfin/${itemId}`, { signal }),
    staleTime: 5 * 60_000,
  });

export type EpisodeStatus = 'available' | 'missing' | 'unaired' | 'unmonitored';

/** One episode of a season, whether or not you have it. */
/** One server's watch state for an episode: by you (solid tick) and/or others (outlined tick). */
export interface EpisodeWatch {
  server: string;
  type: 'jellyfin' | 'plex' | 'emby' | 'silo';
  name: string;
  me: boolean;
  progress?: number;
  others: number;
  /** Admins only. */
  otherNames?: string[];
}

export interface SeasonEpisode {
  number: number;
  season: number;
  name: string;
  overview?: string;
  airDate?: string;
  runtimeMin?: number;
  rating?: number;
  still?: string;
  status: EpisodeStatus;
  monitored?: boolean;
  quality?: string;
  size?: number;
  path?: string;
  file?: Omit<MediaFile, 'audio' | 'subtitles'> & { audio: Partial<MediaFile['audio'][number]>[]; subtitles: Partial<MediaFile['subtitles'][number]>[] };
  jellyfin?: { id: string; url?: string; watch?: WatchState };
  /** Watched on each server (only servers with something to show). */
  watched?: EpisodeWatch[];
  sonarr?: { instance: string; episodeId: number };
}

export interface SeasonEpisodes {
  season: number;
  episodes: SeasonEpisode[];
  counts: { total: number; available: number; missing: number; unaired: number };
  sources: { tmdb: boolean; sonarr: boolean; jellyfin: boolean };
  sonarr?: { instance: string; seriesId: number };
}

/** Every episode of a season (merged from Seerr, Sonarr and Jellyfin), loaded when it's opened. */
export const useSeasonEpisodes = (tmdbId: number | undefined, season: number | undefined) =>
  useQuery({
    queryKey: ['media', 'tv', tmdbId, 'season', season],
    queryFn: ({ signal }) => api<SeasonEpisodes>(`/media/tv/${tmdbId}/seasons/${season}`, { signal }),
    enabled: !!tmdbId && season !== undefined,
    staleTime: 30_000,
  });

/** One season's episodes from Jellyfin, loaded when the season is opened. */
export const useJellyfinEpisodes = (seriesId: string | undefined, seasonId: string | undefined) =>
  useQuery({
    queryKey: ['media', 'jellyfin', seriesId, 'season', seasonId],
    queryFn: ({ signal }) => api<{ episodes: Episode[] }>(`/media/jellyfin/${seriesId}/seasons/${seasonId}/episodes`, { signal }),
    enabled: !!seriesId && !!seasonId,
    staleTime: 60_000,
  });

export function useTitleSearch() {
  return useMutation({ mutationFn: (b: { kind: 'radarr' | 'sonarr'; instance: string; id: number; title: string; season?: number; episodeIds?: number[] }) => api<{ ok: boolean; instance: string }>('/media/search', { method: 'POST', body: b }) });
}

/** Refreshes a title after requesting, adding or approving. */
export function useInvalidateMedia() {
  const qc = useQueryClient();
  return (type: MediaType, tmdbId: number) => void qc.invalidateQueries({ queryKey: ['media', type, tmdbId] });
}

/** Where a title's details live. */
export const mediaPath = (type: MediaType, tmdbId: number) => `/media/${type}/${tmdbId}`;
export const jellyfinPath = (itemId: string) => `/media/jellyfin/${itemId}`;

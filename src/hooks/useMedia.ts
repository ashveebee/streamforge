import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type MediaType = 'movie' | 'tv';
export type Availability = 'available' | 'partial' | 'processing' | 'requested' | 'missing' | 'none';

export interface CastMember {
  name: string;
  character?: string;
  image?: string;
}

export interface MediaDetails {
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
  seasons?: { number: number; name: string; episodes?: number; files?: number; airDate?: string; status: Availability }[];
  availability: Availability;
  jellyfin?: { itemId: string; url?: string };
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
}

export interface JellyfinOnly {
  itemId: string;
  title: string;
  kind: string;
  year?: number;
  overview?: string;
  genres: string[];
  runtimeMin?: number;
  rating?: number;
  certification?: string;
  poster?: string;
  backdrop?: string;
  cast: CastMember[];
  url?: string;
}

export const useMediaDetails = (type: MediaType, tmdbId: number) =>
  useQuery({ queryKey: ['media', type, tmdbId], queryFn: ({ signal }) => api<MediaDetails>(`/media/${type}/${tmdbId}`, { signal }), enabled: tmdbId > 0, refetchInterval: 30_000 });

export const useJellyfinMedia = (itemId: string) =>
  useQuery({
    queryKey: ['media', 'jellyfin', itemId],
    queryFn: ({ signal }) => api<{ redirect?: { type: MediaType; tmdbId: number }; jellyfinOnly?: JellyfinOnly }>(`/media/jellyfin/${itemId}`, { signal }),
    staleTime: 5 * 60_000,
  });

export function useTitleSearch() {
  return useMutation({ mutationFn: (b: { kind: 'radarr' | 'sonarr'; instance: string; id: number; title: string }) => api<{ ok: boolean; instance: string }>('/media/search', { method: 'POST', body: b }) });
}

/** Refreshes a title after requesting, adding or approving. */
export function useInvalidateMedia() {
  const qc = useQueryClient();
  return (type: MediaType, tmdbId: number) => void qc.invalidateQueries({ queryKey: ['media', type, tmdbId] });
}

/** Where a title's details live. */
export const mediaPath = (type: MediaType, tmdbId: number) => `/media/${type}/${tmdbId}`;
export const jellyfinPath = (itemId: string) => `/media/jellyfin/${itemId}`;

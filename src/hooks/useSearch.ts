import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface SearchHit {
  key: string;
  source: 'jellyfin' | 'sonarr' | 'radarr' | 'lidarr' | 'readarr' | 'seerr';
  title: string;
  subtitle?: string;
  year?: number;
  image?: string;
  path?: string;
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
  tvdbId?: number;
  status?: string;
  overview?: string;
}

export interface SearchResults {
  library: SearchHit[];
  managed: SearchHit[];
  discover: SearchHit[];
  canRequest: boolean;
  canAdd: boolean;
}

export const useGlobalSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: ({ signal }) => api<SearchResults>(`/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

export const useRequestMedia = () =>
  useMutation({ mutationFn: (b: { mediaType: 'movie' | 'tv'; tmdbId: number; title: string }) => api<{ ok: boolean }>('/search/request', { method: 'POST', body: b }) });

export const useAddMedia = () =>
  useMutation({
    mutationFn: (b: { kind: 'sonarr' | 'radarr'; tmdbId?: number; tvdbId?: number; title: string }) => api<{ ok: boolean; title: string; instance: string }>('/search/add', { method: 'POST', body: b }),
  });

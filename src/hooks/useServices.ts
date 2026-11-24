import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useConfigured } from './queries';

/* Bazarr, Lidarr and Readarr. */

export interface BazarrOverview {
  counts: { episodes: number; movies: number; providerIssues: number; healthIssues: number };
  episodes: { total: number; items: { seriesId: number; episodeId: number; title: string; subtitle: string; missing: string[] }[] };
  movies: { total: number; items: { movieId: number; title: string; missing: string[] }[] };
  history: { kind: 'episode' | 'movie'; title: string; subtitle: string; language?: string; provider?: string; description?: string; at?: string }[];
}

export type MusicKind = 'lidarr' | 'readarr';

export interface MusicOverview {
  kind: MusicKind;
  stats: { creators: number; monitored: number; releases: number; files: number; total: number; sizeOnDisk: number };
  queue: {
    id: number;
    title: string;
    subtitle?: string;
    releaseTitle: string;
    status: string;
    client?: string;
    protocol?: string;
    quality?: string;
    size: number;
    sizeLeft: number;
    progress: number;
    timeLeft?: string;
    errorMessage?: string;
  }[];
  upcoming: { id: number; title: string; creator: string; date: string; cover?: string }[];
}

export const useBazarr = () => {
  const on = useConfigured('bazarr');
  return useQuery({ queryKey: ['bazarr'], queryFn: ({ signal }) => api<BazarrOverview>('/bazarr/overview', { signal }), refetchInterval: 30_000, enabled: on });
};

export function useBazarrSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { seriesId?: number; movieId?: number; all?: 'episodes' | 'movies' }) => api<{ ok: boolean }>('/bazarr/search', { method: 'POST', body }),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['bazarr'] }), 5000),
  });
}

export const useMusic = (kind: MusicKind) => {
  const on = useConfigured(kind);
  return useQuery({ queryKey: [kind, 'overview'], queryFn: ({ signal }) => api<MusicOverview>(`/${kind}/overview`, { signal }), refetchInterval: 10_000, enabled: on });
};

export function useMusicQueueRemove(kind: MusicKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, blocklist }: { id: number; blocklist: boolean }) => api<{ ok: boolean }>(`/${kind}/queue/${id}/remove`, { method: 'POST', body: { blocklist } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [kind] }),
  });
}

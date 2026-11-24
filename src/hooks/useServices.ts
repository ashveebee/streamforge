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

/* --------------------------- Jellyfin tasks/scans --------------------------- */

export interface JellyfinTask {
  id: string;
  key?: string;
  name: string;
  category: string;
  description?: string;
  state: 'Idle' | 'Running' | 'Cancelling';
  progress?: number;
  last?: { startedAt?: string; endedAt?: string; status?: string; error?: string };
  schedule: string[];
}

export const useJellyfinTasks = (enabled: boolean) =>
  useQuery({
    queryKey: ['jellyfin', 'tasks'],
    queryFn: ({ signal }) => api<JellyfinTask[]>('/jellyfin/tasks', { signal }),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((t) => t.state !== 'Idle') ? 2000 : 30_000),
  });

export function useTaskControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, op, name }: { id: string; op: 'start' | 'stop'; name: string }) => api(`/jellyfin/tasks/${id}/${op}`, { method: 'POST', body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jellyfin', 'tasks'] }),
  });
}

export function useLibraryScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { library?: string; name?: string; full?: boolean }) => api('/jellyfin/scan', { method: 'POST', body: b }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jellyfin', 'tasks'] });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ['jellyfin', 'overview'] }), 2000);
    },
  });
}

/* ---------------------------- cleanup suggestions ---------------------------- */

export interface ReclaimItem {
  key: string;
  kind: 'movie' | 'series';
  instance: string;
  instanceName?: string;
  arrId: number;
  title: string;
  year?: number;
  size: number;
  added?: string;
  lastWatched?: string;
  poster?: string;
  ended?: boolean;
  tmdbId?: number;
}
export interface ReclaimResult {
  days: number;
  total: number;
  reclaimable: number;
  kept: number;
  items: ReclaimItem[];
  checkedAt: string;
}

export const useReclaim = (days: number) =>
  useQuery({ queryKey: ['library', 'reclaim', days], queryFn: ({ signal }) => api<ReclaimResult>(`/library/reclaim?days=${days}`, { signal }), placeholderData: (p) => p, staleTime: 60_000 });

export function useReclaimAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { kind: 'movie' | 'series'; instance: string; id: number; action: 'delete' | 'unmonitor' | 'keep' | 'unkeep' }) => api('/library/reclaim', { method: 'POST', body: b }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library', 'reclaim'] }),
  });
}

/* ------------------------------ playback guard ------------------------------ */

export interface GuardSettings {
  enabled: boolean;
  maxTranscodes: number;
  fourK: 'off' | 'alert' | 'message';
  maxMbps: number;
  message: string;
}
export interface GuardStatus {
  settings: GuardSettings;
  last: { at?: string; streams: number; transcodes: number; mbps: number; error?: string };
  recent: { at: string; kind: 'transcodes' | '4k' | 'bandwidth'; message: string }[];
}

export const useGuard = (enabled: boolean) =>
  useQuery({ queryKey: ['jellyfin', 'guard'], queryFn: ({ signal }) => api<GuardStatus>('/jellyfin/guard', { signal }), enabled, refetchInterval: 30_000 });

export function useSaveGuard() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: Partial<GuardSettings>) => api<GuardStatus>('/jellyfin/guard', { method: 'PUT', body: b }), onSuccess: (d) => qc.setQueryData(['jellyfin', 'guard'], d) });
}

/* --------------------------------- digest --------------------------------- */

export interface Digest {
  from: string;
  to: string;
  added: {
    movies: { id: string; title: string; year?: number; image?: string }[];
    shows: { id: string; title: string; episodes: number; image?: string }[];
    other: { id: string; title: string; kind: string }[];
    runtimeMs: number;
  };
  watched?: { plays: number; watchedMs: number; viewers: number; top: { title: string; plays: number }[] };
  storage: { used: number; total: number; soonest?: { label: string; daysLeft: number } };
}
export interface DigestSettings {
  enabled: boolean;
  day: number;
  hour: number;
  lastSent: string | null;
  canSend: boolean;
}

export const useDigest = () => useQuery({ queryKey: ['digest'], queryFn: ({ signal }) => api<Digest>('/digest', { signal }), staleTime: 5 * 60_000 });
export const useDigestSettings = (enabled: boolean) =>
  useQuery({ queryKey: ['digest', 'settings'], queryFn: ({ signal }) => api<DigestSettings>('/digest/settings', { signal }), enabled });
export function useSaveDigest() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: Partial<DigestSettings>) => api<DigestSettings>('/digest/settings', { method: 'PUT', body: b }), onSuccess: (d) => qc.setQueryData(['digest', 'settings'], d) });
}
export function useSendDigest() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<DigestSettings>('/digest/send', { method: 'POST' }), onSuccess: (d) => qc.setQueryData(['digest', 'settings'], d) });
}

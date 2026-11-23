import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type {
  ActivityEntry,
  DownloadSnapshot,
  HealthSnapshot,
  HostSnapshot,
  InfinidiskOverview,
  JellyfinOverview,
  LatestItem,
  NowPlaying,
  PlayDay,
  ProwlarrOverview,
  RadarrOverview,
  SeerrOverview,
  ServiceId,
  SonarrOverview,
} from '@/lib/types';

/*
 * Real-time strategy: every endpoint is polled at a cadence that matches how
 * fast the underlying data changes. React Query pauses polling for hidden tabs
 * and de-duplicates across widgets; the backend de-duplicates across users.
 */
const SECOND = 1000;

function poll<T>(key: string[], path: string, intervalMs: number, enabled = true) {
  return {
    queryKey: key,
    queryFn: ({ signal }: { signal: AbortSignal }) => api<T>(path, { signal }),
    refetchInterval: intervalMs,
    enabled,
  };
}

export const useServiceConfig = () =>
  useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ services: Record<ServiceId, boolean> }>('/config'),
    staleTime: Infinity,
  });

export function useConfigured(id: ServiceId) {
  const { data } = useServiceConfig();
  return data?.services[id] ?? true;
}

export const useHealth = () => useQuery(poll<HealthSnapshot>(['health'], '/health', 10 * SECOND));
export const useHost = () => useQuery(poll<HostSnapshot>(['host'], '/system/host', 5 * SECOND));
export const useDownloads = () => useQuery(poll<DownloadSnapshot>(['downloads'], '/downloads', 5 * SECOND));

export const useNowPlaying = () =>
  useQuery(poll<NowPlaying[]>(['jellyfin', 'now-playing'], '/jellyfin/now-playing', 5 * SECOND));
export const useJellyfin = () =>
  useQuery(poll<JellyfinOverview>(['jellyfin', 'overview'], '/jellyfin/overview', 30 * SECOND));
export const useLatest = () => useQuery(poll<LatestItem[]>(['jellyfin', 'latest'], '/jellyfin/latest', 120 * SECOND));
export const useActivity = () =>
  useQuery(poll<ActivityEntry[]>(['jellyfin', 'activity'], '/jellyfin/activity', 20 * SECOND));
export const usePlays = () => useQuery(poll<PlayDay[]>(['jellyfin', 'plays'], '/jellyfin/plays', 300 * SECOND));

export const useSonarr = () => {
  const on = useConfigured('sonarr');
  return useQuery(poll<SonarrOverview>(['sonarr'], '/sonarr/overview', 10 * SECOND, on));
};
export const useRadarr = () => {
  const on = useConfigured('radarr');
  return useQuery(poll<RadarrOverview>(['radarr'], '/radarr/overview', 10 * SECOND, on));
};
export const useProwlarr = () => {
  const on = useConfigured('prowlarr');
  return useQuery(poll<ProwlarrOverview>(['prowlarr'], '/prowlarr/overview', 30 * SECOND, on));
};
export const useSeerr = () => {
  const on = useConfigured('seerr');
  return useQuery(poll<SeerrOverview>(['seerr'], '/seerr/overview', 20 * SECOND, on));
};
export const useInfinidisk = () => {
  const on = useConfigured('infinidisk');
  return useQuery(poll<InfinidiskOverview>(['infinidisk'], '/infinidisk/overview', 15 * SECOND, on));
};

export function useRecheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<HealthSnapshot>('/health/recheck', { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(['health'], data);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'health' && q.queryKey[0] !== 'config' });
    },
  });
}

export const isNotConfigured = (e: unknown) => e instanceof ApiError && e.notConfigured;

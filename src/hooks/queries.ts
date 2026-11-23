import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type {
  ActivityEntry,
  ArrInstanceRef,
  ArrInstanceView,
  ArrKind,
  ChannelInput,
  MissingPage,
  PlaybackStats,
  NotificationsStatus,
  AutoImportEntry,
  CleanupEntry,
  CleanupStatus,
  AutoImportStatus,
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
  ConnectionTest,
  ServiceId,
  ServiceSettingsInput,
  ServiceSettingsView,
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
    queryFn: () =>
      api<{ services: Record<ServiceId, boolean>; enabled: Record<ServiceId, boolean>; instances: ArrInstanceRef[] }>('/config'),
    staleTime: Infinity,
  });

export function useConfigured(id: ServiceId) {
  const { data } = useServiceConfig();
  return data?.services[id] ?? true;
}

/** False only once the server says the service has been switched off. */
export function useEnabled(id: ServiceId) {
  const { data } = useServiceConfig();
  return data?.enabled?.[id] ?? true;
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

/** Sonarr/Radarr instances, primary first. Empty until /config has loaded. */
export function useInstances(kind: ArrKind): ArrInstanceRef[] {
  const { data } = useServiceConfig();
  return data?.instances?.filter((i) => i.kind === kind) ?? [];
}

const q = (instance: string) => `?instance=${encodeURIComponent(instance)}`;

type Overview<K extends ArrKind> = K extends 'sonarr' ? SonarrOverview : RadarrOverview;

/** One instance's overview; `instance` defaults to the first (primary) one. */
function useArr<K extends ArrKind>(kind: K, instance?: string) {
  const list = useInstances(kind);
  const id = instance && list.some((i) => i.id === instance) ? instance : list[0]?.id;
  return useQuery(poll<Overview<K>>([kind, id ?? 'none', 'overview'], `/${kind}/overview${q(id ?? kind)}`, 10 * SECOND, !!id));
}
export const useSonarr = (instance?: string) => useArr('sonarr', instance);
export const useRadarr = (instance?: string) => useArr('radarr', instance);

/** Overviews of every instance of a kind (for dashboard widgets). */
export function useArrAll<K extends ArrKind>(kind: K) {
  const list = useInstances(kind);
  return useQueries({
    queries: list.map((i) => poll<Overview<K>>([kind, i.id, 'overview'], `/${kind}/overview${q(i.id)}`, 10 * SECOND)),
  });
}
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

/* ------------------------------- settings ------------------------------- */

export const useServiceSettings = () =>
  useQuery({
    queryKey: ['settings', 'services'],
    queryFn: ({ signal }) => api<{ services: ServiceSettingsView[] }>('/settings/services', { signal }),
  });

export const useTestService = (id: ServiceId) =>
  useMutation({
    mutationFn: (input: ServiceSettingsInput) =>
      api<ConnectionTest>(`/settings/services/${id}/test`, { method: 'POST', body: input }),
  });

/** After a change, refresh everything that depends on which services exist. */
function useSettingsChanged() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['settings'] });
    void qc.invalidateQueries({ queryKey: ['config'] });
    // Give the server's immediate re-check a moment before refreshing health.
    setTimeout(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' }), 1500);
  };
}

type SaveResult = { service: ServiceSettingsView; signedOut: boolean };

export function useSaveService(id: ServiceId) {
  const changed = useSettingsChanged();
  return useMutation({
    mutationFn: (input: ServiceSettingsInput) =>
      api<SaveResult>(`/settings/services/${id}`, { method: 'PUT', body: input }),
    onSuccess: changed,
  });
}

export function useResetService(id: ServiceId) {
  const changed = useSettingsChanged();
  return useMutation({
    mutationFn: () => api<SaveResult>(`/settings/services/${id}`, { method: 'DELETE' }),
    onSuccess: changed,
  });
}

export function useSetServiceEnabled(id: ServiceId) {
  const changed = useSettingsChanged();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api<SaveResult>(`/settings/services/${id}/enabled`, { method: 'PUT', body: { enabled } }),
    onSuccess: changed,
  });
}

/* ------------------------------ auto-import ------------------------------ */

export const useAutoImport = (kind: ArrKind) => {
  const on = useConfigured(kind);
  return useQuery(poll<AutoImportStatus>([kind, 'auto-import'], `/${kind}/auto-import`, 15 * SECOND, on));
};

export function useUpdateAutoImport(kind: ArrKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AutoImportStatus['settings']>) =>
      api<AutoImportStatus>(`/${kind}/auto-import`, { method: 'PUT', body: patch }),
    onSuccess: (data) => qc.setQueryData([kind, 'auto-import'], data),
  });
}

export function useRunAutoImport(kind: ArrKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { dryRun?: boolean; queueId?: number; instance?: string }) =>
      api<{ results: AutoImportEntry[]; status: AutoImportStatus }>(`/${kind}/auto-import/run`, { method: 'POST', body: opts }),
    onSuccess: (data) => {
      qc.setQueryData([kind, 'auto-import'], data.status);
      void qc.invalidateQueries({ queryKey: [kind] });
    },
  });
}

/* ---------------------------- extra instances ---------------------------- */

export const useInstanceSettings = () =>
  useQuery({
    queryKey: ['settings', 'instances'],
    queryFn: ({ signal }) => api<{ instances: ArrInstanceView[] }>('/settings/instances', { signal }),
  });

export type InstanceInput = { kind?: ArrKind; name?: string; url?: string; apiKey?: string; enabled?: boolean };

export const useTestInstance = () =>
  useMutation({
    mutationFn: (input: InstanceInput & { id?: string }) =>
      api<ConnectionTest>('/settings/instances/test', { method: 'POST', body: input }),
  });

export function useSaveInstance() {
  const changed = useSettingsChanged();
  return useMutation({
    mutationFn: ({ id, ...input }: InstanceInput & { id?: string }) =>
      id
        ? api<{ instance: ArrInstanceView }>(`/settings/instances/${id}`, { method: 'PUT', body: input })
        : api<{ instance: ArrInstanceView }>('/settings/instances', { method: 'POST', body: input }),
    onSuccess: changed,
  });
}

export function useRemoveInstance() {
  const changed = useSettingsChanged();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/settings/instances/${id}`, { method: 'DELETE' }),
    onSuccess: changed,
  });
}

/* ------------------------------ queue actions ----------------------------- */

export type QueueActionName = 'remove' | 'remove-keep' | 'blocklist' | 'blocklist-search' | 'grab';

export function useQueueAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, instance, id, action }: { kind: ArrKind; instance: string; id: number; action: QueueActionName }) =>
      api<{ ok: true }>(`/${kind}/queue/${id}/action`, { method: 'POST', body: { action, instance } }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: [v.kind] }),
  });
}

/* ---------------------------- download cleanup --------------------------- */

export const useCleanup = () => useQuery(poll<CleanupStatus>(['cleanup'], '/downloads/cleanup', 30 * SECOND));

export function useUpdateCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CleanupStatus['settings']>) => api<CleanupStatus>('/downloads/cleanup', { method: 'PUT', body: patch }),
    onSuccess: (d) => qc.setQueryData(['cleanup'], d),
  });
}

export function useRunCleanup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dryRun: boolean) =>
      api<{ results: CleanupEntry[]; status: CleanupStatus }>('/downloads/cleanup/run', { method: 'POST', body: { dryRun } }),
    onSuccess: (d) => {
      qc.setQueryData(['cleanup'], d.status);
      void qc.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}

/* ------------------------------ notifications ----------------------------- */

export const useNotifications = () =>
  useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn: ({ signal }) => api<NotificationsStatus>('/settings/notifications', { signal }),
    refetchInterval: 15 * SECOND,
  });

function useNotifyMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'notifications'] }) });
}

export const useSaveChannel = () =>
  useNotifyMutation(({ id, ...input }: ChannelInput & { id?: string }) =>
    id
      ? api(`/settings/notifications/channels/${id}`, { method: 'PUT', body: input })
      : api('/settings/notifications/channels', { method: 'POST', body: input }),
  );
export const useRemoveChannel = () => useNotifyMutation((id: string) => api(`/settings/notifications/channels/${id}`, { method: 'DELETE' }));
export const useTestChannel = () =>
  useNotifyMutation((id: string) => api<{ ok: boolean; message?: string }>(`/settings/notifications/channels/${id}/test`, { method: 'POST' }));
export const useSavePublicUrl = () =>
  useNotifyMutation((url: string) => api('/settings/notifications/public-url', { method: 'PUT', body: { url } }));

/* --------------------------------- missing -------------------------------- */

export function useMissing(kind: ArrKind, instance: string | undefined, page: number) {
  return useQuery({
    queryKey: [kind, instance ?? 'none', 'missing', page],
    queryFn: ({ signal }) => api<MissingPage>(`/${kind}/missing?instance=${encodeURIComponent(instance ?? kind)}&page=${page}`, { signal }),
    enabled: !!instance,
    placeholderData: (prev) => prev,
    refetchInterval: 60 * SECOND,
  });
}

export function useSearch(kind: ArrKind) {
  return useMutation({
    mutationFn: ({ instance, ids }: { instance?: string; ids: number[] }) =>
      api<{ ok: boolean }>(`/${kind}/search`, { method: 'POST', body: { instance, ids } }),
  });
}

/* ------------------------------ seerr approvals ----------------------------- */

export function useDecideRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: 'approve' | 'decline' }) =>
      api<{ ok: true }>(`/seerr/requests/${id}/${decision}`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seerr'] }),
  });
}

/* ---------------------------- jellyfin sessions ---------------------------- */

export function useSessionControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command, text }: { id: string; command: 'pause' | 'unpause' | 'stop' | 'message'; text?: string }) =>
      api<{ ok: true }>(`/jellyfin/sessions/${encodeURIComponent(id)}/control`, { method: 'POST', body: { command, text } }),
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['jellyfin', 'now-playing'] }), 800),
  });
}

export const usePlaybackStats = (days: number) =>
  useQuery({ ...poll<PlaybackStats>(['jellyfin', 'stats', String(days)], `/jellyfin/stats?days=${days}`, 5 * 60 * SECOND), placeholderData: (p) => p });

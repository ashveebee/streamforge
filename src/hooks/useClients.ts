import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConnectionTest } from '@/lib/types';
import { useServiceConfig } from './queries';

export type ClientType = 'qbittorrent' | 'transmission' | 'sabnzbd' | 'nzbget';
export type ItemState = 'downloading' | 'seeding' | 'paused' | 'queued' | 'checking' | 'stalled' | 'completed' | 'error';
export type ItemAction = 'pause' | 'resume' | 'remove' | 'remove-data';

export interface ClientItem {
  id: string;
  name: string;
  state: ItemState;
  progress: number;
  size: number;
  downloaded: number;
  downSpeed: number;
  upSpeed: number;
  eta?: number;
  ratio?: number;
  category?: string;
  addedAt?: string;
  error?: string;
}

export interface ClientView {
  id: string;
  type: ClientType;
  typeName: string;
  name: string;
  online: boolean;
  error?: string;
  lastCheck?: string;
  lastSuccess?: string;
  latencyMs?: number;
  version?: string;
  protocol?: 'torrent' | 'usenet';
  downSpeed?: number;
  upSpeed?: number;
  downLimit?: number;
  upLimit?: number;
  paused?: boolean;
  freeSpace?: number;
  /** At most a few hundred, chosen by the server; `summary` counts all of them. */
  items?: ClientItem[];
  summary?: ItemSummary;
}

export interface ItemSummary {
  total: number;
  downloading: number;
  active: number;
  seeding: number;
  paused: number;
  error: number;
  remaining: number;
}

export interface ClientsSnapshot {
  clients: ClientView[];
  history: { t: number; down: number; up: number }[];
  sampleIntervalMs: number;
}

export interface ClientSettingsView {
  id: string;
  type: ClientType;
  name: string;
  url: string;
  username: string;
  enabled: boolean;
  passwordSet: boolean;
  apiKeySet: boolean;
  apiKeyHint?: string;
  createdAt: string;
}

export interface ClientInput {
  id?: string;
  type?: ClientType;
  name?: string;
  url?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  enabled?: boolean;
}

export const useHasClients = () => !!useServiceConfig().data?.downloadClients;

export function useClients() {
  const on = useHasClients();
  return useQuery({ queryKey: ['clients'], queryFn: ({ signal }) => api<ClientsSnapshot>('/clients', { signal }), refetchInterval: (q) => q.state.data?.sampleIntervalMs ?? 5000, enabled: on });
}

function useClientMutation<V>(fn: (v: V) => Promise<ClientsSnapshot>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (d) => qc.setQueryData(['clients'], d) });
}

export const useClientPause = () =>
  useClientMutation(({ id, paused }: { id: string; paused: boolean }) => api<ClientsSnapshot>(`/clients/${id}/paused`, { method: 'POST', body: { paused } }));
export const useClientItem = () =>
  useClientMutation(({ id, item, action, name }: { id: string; item: string; action: ItemAction; name: string }) =>
    api<ClientsSnapshot>(`/clients/${id}/items/${encodeURIComponent(item)}/${action}`, { method: 'POST', body: { name } }),
  );
export const useClientLimits = () =>
  useClientMutation(({ id, down, up }: { id: string; down: number; up: number }) => api<ClientsSnapshot>(`/clients/${id}/limits`, { method: 'PUT', body: { down, up } }));

/* ------------------------------- settings ------------------------------- */

export const useClientSettings = () =>
  useQuery({
    queryKey: ['settings', 'clients'],
    queryFn: ({ signal }) => api<{ clients: ClientSettingsView[]; types: { id: ClientType; name: string; fields: ('username' | 'password' | 'apiKey')[] }[] }>('/settings/clients', { signal }),
  });

export const useTestClient = () => useMutation({ mutationFn: (b: ClientInput) => api<ConnectionTest>('/settings/clients/test', { method: 'POST', body: b }) });

export function useSaveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: ClientInput) => api<{ client: ClientSettingsView }>(id ? `/settings/clients/${id}` : '/settings/clients', { method: id ? 'PUT' : 'POST', body: id ? (({ type: _t, ...rest }) => rest)(b) : b }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
      void qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useRemoveClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/settings/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'clients'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

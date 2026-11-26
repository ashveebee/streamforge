import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ArtworkRef } from '@/lib/api';
import type { SeerrRequest } from '@/lib/types';

export interface MeCard {
  id: string;
  title: string;
  subtitle?: string;
  progress?: number;
  remainingMs?: number;
  lastPlayed?: string;
  image?: ArtworkRef;
}

export interface MeOverview {
  resume: MeCard[];
  nextUp: MeCard[];
  history: { title: string; subtitle?: string; client?: string; transcoded: boolean; at: string; watchedMs: number }[];
  month: { plays: number; watchedMs: number };
  requestsAvailable: boolean;
}

export interface SignedInSession {
  id: string;
  current: boolean;
  method: 'password' | 'oidc';
  userAgent?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export const useMe = () => useQuery({ queryKey: ['me', 'overview'], queryFn: ({ signal }) => api<MeOverview>('/me/overview', { signal }), refetchInterval: 60_000 });
export const useMyRequests = (enabled: boolean) =>
  useQuery({ queryKey: ['me', 'requests'], queryFn: ({ signal }) => api<{ linked: boolean; requests: SeerrRequest[] }>('/me/requests', { signal }), enabled, refetchInterval: 60_000 });
export const useMySessions = () => useQuery({ queryKey: ['me', 'sessions'], queryFn: ({ signal }) => api<{ sessions: SignedInSession[] }>('/auth/sessions', { signal }) });

/** Your account on another media server: linked by you, or found by name. */
export interface MyAccount {
  server: string;
  name: string;
  type: 'jellyfin' | 'plex' | 'emby';
  linked?: { id: string; name: string };
  matched?: { id: string; name: string };
  /** The server's accounts, for admins to pick from. */
  users?: { id: string; name: string }[];
  reachable: boolean;
}

export const useMyAccounts = () => useQuery({ queryKey: ['me', 'accounts'], queryFn: ({ signal }) => api<MyAccount[]>('/me/accounts', { signal }) });

export function useLinkAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { server: string; accountId: string | null }) => api<MyAccount[]>(`/me/accounts/${encodeURIComponent(b.server)}`, { method: 'PUT', body: { accountId: b.accountId } }),
    onSuccess: (data) => {
      qc.setQueryData(['me', 'accounts'], data);
      // Episode ticks depend on who "you" are on each server.
      void qc.invalidateQueries({ queryKey: ['media'] });
    },
  });
}

export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'sessions'] }) });
}

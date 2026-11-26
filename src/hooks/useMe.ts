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

export function useEndSession() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'sessions'] }) });
}

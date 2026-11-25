import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Release {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  notes: { heading: string; items: string[] }[];
}

export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest?: string;
  /** The newest version above the running one, when there is one. */
  available?: string;
  /** Every release newer than the running one, newest first. */
  releases: Release[];
  checkedAt?: number;
  error?: string;
  repoUrl: string;
}

/** Admins only: is a newer StreamForge out? */
export function useUpdates(enabled = true) {
  return useQuery({
    queryKey: ['updates'],
    enabled,
    queryFn: ({ signal }) => api<UpdateStatus>('/updates', { signal }),
    staleTime: 10 * 60_000,
    refetchInterval: 30 * 60_000,
  });
}

export function useCheckUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<UpdateStatus>('/updates/check', { method: 'POST' }),
    onSuccess: (d) => qc.setQueryData(['updates'], d),
  });
}

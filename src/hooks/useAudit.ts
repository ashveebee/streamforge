import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface AuditEntry {
  id: number;
  at: string;
  userId?: string;
  userName?: string;
  ip?: string;
  category: string;
  message: string;
  ok: boolean;
}

interface AuditPage {
  entries: AuditEntry[];
  more: boolean;
  categories: string[];
  users: string[];
}

export function useAudit(filters: { category?: string; user?: string; q?: string }) {
  return useInfiniteQuery({
    queryKey: ['audit', filters],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
      if (pageParam) p.set('before', String(pageParam));
      return api<AuditPage>(`/audit?${p}`, { signal });
    },
    getNextPageParam: (last) => (last.more ? last.entries.at(-1)?.id : undefined),
    refetchInterval: 30_000,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type ConditionType = 'disk_usage' | 'disk_days_left' | 'service_offline' | 'stalled_downloads' | 'pending_requests' | 'active_streams' | 'ended_unwatched';
export type ActionType = 'notify' | 'pause_downloads' | 'resume_downloads' | 'run_cleanup' | 'unmonitor';

export interface RuleInput {
  name: string;
  enabled: boolean;
  condition: ConditionType;
  value: number;
  actions: ActionType[];
  cooldownHours: number;
}
export interface Rule extends RuleInput {
  id: string;
  createdAt: string;
  state: { lastCheck?: string; matched?: boolean; summary?: string; lastFired?: string; lastError?: string };
}
export interface RulesStatus {
  rules: Rule[];
  conditions: Record<ConditionType, { label: string; param: { name: string; min: number; max: number; default: number; unit: string } }>;
  actions: Record<ActionType, { label: string; for: ConditionType[] | null }>;
}

export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: ({ signal }) => api<RulesStatus>('/rules', { signal }), refetchInterval: 60_000 });

export function useSaveRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: RuleInput & { id?: string }) => api<RulesStatus>(id ? `/rules/${id}` : '/rules', { method: id ? 'PUT' : 'POST', body: b }),
    onSuccess: (d) => qc.setQueryData(['rules'], d),
  });
}
export function useRemoveRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<RulesStatus>(`/rules/${id}`, { method: 'DELETE' }), onSuccess: (d) => qc.setQueryData(['rules'], d) });
}
export function useRunRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, fire }: { id: string; fire: boolean }) => api<{ matched: boolean; summary: string; error?: string; status: RulesStatus }>(`/rules/${id}/run`, { method: 'POST', body: { fire } }),
    onSuccess: (d) => qc.setQueryData(['rules'], d.status),
  });
}

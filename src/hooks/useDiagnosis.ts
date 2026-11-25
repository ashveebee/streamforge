import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

export interface Incident {
  id: string;
  session: string;
  item: string;
  user: string;
  title: string;
  device?: string;
  client?: string;
  remote: boolean;
  method: PlayMethod;
  start: number;
  end: number;
  lostMs: number;
}

export interface DiagnosisStatus {
  recording: boolean;
  reason?: string;
  since?: number;
  sampleMs: number;
  keepDays: number;
  uploadMbps: number | null;
  hostMetrics: boolean;
  incidents: Incident[];
  plays: { id: string; user: string; title: string; device?: string; remote: boolean; first: number; last: number }[];
}

export interface Finding {
  id: 'transcode' | 'cpu' | 'upload' | 'bitrate' | 'downloads' | 'jellyfin' | 'client';
  title: string;
  detail: string;
  confidence: number | null;
  evidence: string[];
  fixes: string[];
}

export interface Analysis {
  incident?: Incident;
  from: number;
  to: number;
  focus: { from: number; to: number };
  stream?: {
    id: string;
    user: string;
    title: string;
    device?: string;
    client?: string;
    remote: boolean;
    method: PlayMethod;
    res?: string;
    codec?: string;
    bitrate?: number;
    hw?: string;
    reasons: string[];
  };
  findings: Finding[];
  stalls: { start: number; end: number }[];
  others: { user: string; title: string; method: PlayMethod; remote: boolean; bitrate?: number }[];
  series: {
    t: number;
    cpu?: number;
    tx?: number;
    rx?: number;
    down?: number;
    up?: number;
    bitrate?: number;
    speed?: number;
    streams: number;
    transcodes: number;
    jfMs?: number;
  }[];
  upload?: { capacity: number; estimated: boolean };
  hasHost: boolean;
  hasClients: boolean;
}

export type Question = { incident: string } | { session?: string; at: number };

export function useDiagnosis() {
  return useQuery({
    queryKey: ['diagnosis'],
    queryFn: ({ signal }) => api<DiagnosisStatus>('/diagnosis', { signal }),
    refetchInterval: 60_000,
  });
}

export function useExplain(q: Question | undefined) {
  return useQuery({
    queryKey: ['diagnosis', 'explain', q],
    enabled: !!q,
    queryFn: ({ signal }) => {
      const p = new URLSearchParams();
      if (q && 'incident' in q) p.set('incident', q.incident);
      else if (q) {
        p.set('at', String(q.at));
        if (q.session) p.set('session', q.session);
      }
      return api<Analysis>(`/diagnosis/explain?${p}`, { signal });
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSetUploadSpeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uploadMbps: number | null) => api<DiagnosisStatus>('/diagnosis/settings', { method: 'PUT', body: { uploadMbps } }),
    onSuccess: (data) => {
      qc.setQueryData(['diagnosis'], data);
      void qc.invalidateQueries({ queryKey: ['diagnosis', 'explain'] });
    },
  });
}

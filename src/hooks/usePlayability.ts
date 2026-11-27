import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { t } from '@/i18n';

export type Verdict = 'direct' | 'remux' | 'audio' | 'video';
export type FeatureKind = 'container' | 'vcodec' | 'range' | 'bitdepth' | 'res' | 'acodec' | 'channels' | 'sub';

export interface Capability {
  kind: FeatureKind;
  value: string;
  label: string;
  status: 'yes' | 'no';
  ok: number;
  bad: number;
  lastAt: number;
}

export interface DeviceSummary {
  key: string;
  device: string;
  client?: string;
  plays: number;
  lastSeen: number;
}

export interface PlayabilityStatus {
  ready: boolean;
  devices: (DeviceSummary & { household: boolean; direct: number; converted: number; capabilities: Capability[]; bitrateLimited: number })[];
}

export interface DeviceReport {
  device: DeviceSummary;
  capabilities: Capability[];
  bitrateLimited: number;
  scannedAt: number;
  files: number;
  counts: Record<Verdict, number>;
  causes: { text: string; verdict: Verdict; files: number }[];
  untested: { text: string; files: number }[];
  titles: { id: string; title: string; kind: 'movie' | 'series'; year?: number; files: number; counts: Record<Verdict, number>; problems: string[]; worst: Verdict }[];
  moreTitles: number;
}

export interface TitlePlayability {
  files: number;
  devices: (DeviceSummary & {
    verdict: Verdict;
    counts: Record<Verdict, number>;
    problems: string[];
    untested: string[];
    subtitleWarning?: string;
    version?: string;
  })[];
}

export const VERDICT: Record<Verdict, { label: string; tone: 'ok' | 'neutral' | 'warn' | 'bad'; hint: string }> = {
  direct: { get label() { return t('widgets.verdict.direct'); }, tone: 'ok', get hint() { return t('widgets.verdict.directHint'); } },
  remux: { get label() { return t('widgets.verdict.remux'); }, tone: 'neutral', get hint() { return t('widgets.verdict.remuxHint'); } },
  audio: { get label() { return t('widgets.verdict.audio'); }, tone: 'warn', get hint() { return t('widgets.verdict.audioHint'); } },
  video: { get label() { return t('widgets.verdict.video'); }, tone: 'bad', get hint() { return t('widgets.verdict.videoHint'); } },
};

export function usePlayability(enabled = true) {
  return useQuery({
    queryKey: ['playability'],
    enabled,
    queryFn: ({ signal }) => api<PlayabilityStatus>('/playability', { signal }),
    staleTime: 60_000,
  });
}

export function useDeviceReport(key: string | undefined) {
  return useQuery({
    queryKey: ['playability', 'device', key],
    enabled: !!key,
    queryFn: ({ signal }) => api<DeviceReport>(`/playability/device?key=${encodeURIComponent(key!)}`, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useTitlePlayability(itemId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['playability', 'title', itemId],
    enabled: !!itemId && enabled,
    queryFn: ({ signal }) => api<TitlePlayability>(`/playability/title/${encodeURIComponent(itemId!)}`, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

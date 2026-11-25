import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  direct: { label: 'Plays directly', tone: 'ok', hint: 'No work for the server' },
  remux: { label: 'Repackaged', tone: 'neutral', hint: 'Jellyfin changes the file type on the fly: light work' },
  audio: { label: 'Audio converts', tone: 'warn', hint: 'Jellyfin converts the sound: some CPU, picture untouched' },
  video: { label: 'Video converts', tone: 'bad', hint: 'Jellyfin converts the picture: heavy work, can cause buffering' },
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

export type ServiceId = 'jellyfin' | 'sonarr' | 'radarr' | 'prowlarr' | 'seerr' | 'infinidisk' | 'bazarr' | 'lidarr' | 'readarr';

export interface HealthIssue {
  level: 'info' | 'warning' | 'error';
  message: string;
  source?: string;
  wikiUrl?: string;
}

export interface HealthProbe {
  version?: string;
  issues: HealthIssue[];
  /** Optional extra key facts shown on the status card. */
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface QueueItem {
  id: number;
  source: 'sonarr' | 'radarr';
  /** Instance id (`sonarr`, `radarr`, or an extra instance like `radarr-4k`). */
  instance: string;
  instanceName?: string;
  downloadId?: string;
  added?: string;
  title: string;
  subtitle?: string;
  releaseTitle: string;
  status: string;
  trackedState?: string;
  trackedStatus?: string;
  protocol?: string;
  client?: string;
  quality?: string;
  size: number;
  sizeLeft: number;
  progress: number;
  timeLeft?: string;
  estimatedCompletion?: string;
  errorMessage?: string;
  warnings: string[];
  poster?: string;
  tmdbId?: number;
}

export interface UpcomingItem {
  id: string;
  source: 'sonarr' | 'radarr';
  title: string;
  subtitle?: string;
  date: string;
  kind: 'episode' | 'cinema' | 'digital' | 'physical';
  hasFile: boolean;
  monitored: boolean;
  network?: string;
  poster?: string;
  tmdbId?: number;
}

export interface DiskInfo {
  path: string;
  label?: string;
  free: number;
  total: number;
}

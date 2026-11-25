import type { ArtworkRef } from './api';

/* Client-side view of the StreamForge API. Mirrors server/ responses. */

export type ServiceId = 'jellyfin' | 'sonarr' | 'radarr' | 'prowlarr' | 'seerr' | 'infinidisk' | 'bazarr' | 'lidarr' | 'readarr';
export type ServiceStatus = 'healthy' | 'degraded' | 'offline' | 'unconfigured';

export interface User {
  id: string;
  name: string;
  isAdmin: boolean;
  imageTag?: string;
  expiresAt: string;
}

export interface HealthIssue {
  level: 'info' | 'warning' | 'error';
  message: string;
  source?: string;
  wikiUrl?: string;
}

export interface ServiceHealth {
  /** Service id, or an extra Sonarr/Radarr instance id such as `radarr-4k`. */
  id: string;
  kind: ServiceId;
  /** Set for extra Sonarr/Radarr instances and extra media servers. */
  instance?: string;
  /** Extra media servers only: Jellyfin, Emby or Plex. */
  serverType?: MediaServerType;
  name: string;
  configured: boolean;
  status: ServiceStatus;
  version?: string;
  latencyMs?: number;
  lastCheck?: string;
  lastSuccess?: string;
  error?: string;
  reason?: string;
  issues: HealthIssue[];
  meta?: Record<string, string | number | boolean | undefined>;
  /** Address to open the service in a browser (primary services only). */
  publicUrl?: string;
  uptime?: number;
  history: { t: number; ms: number | null }[];
}

export interface HealthSnapshot {
  services: ServiceHealth[];
  checkedAt?: string;
  intervalMs: number;
  summary: { healthy: number; degraded: number; offline: number; unconfigured: number };
}

export interface HostSnapshot {
  enabled: boolean;
  info?: { hostname: string; platform: string; distro?: string; cpuModel: string; cores: number; memTotal: number };
  current?: {
    cpu: number;
    perCore: number[];
    memUsed: number;
    memTotal: number;
    swapUsed: number;
    swapTotal: number;
    rx: number;
    tx: number;
    load: number[];
    uptime: number;
    temperature?: number;
  };
  history: { t: number; cpu: number; mem: number; rx: number; tx: number }[];
  filesystems: { mount: string; fs: string; type: string; size: number; used: number; available: number; usage: number }[];
  error?: string;
}

export interface DownloadSnapshot {
  available: boolean;
  current: number;
  peak: number;
  history: { t: number; sonarr: number; radarr: number }[];
  itemSpeeds: Record<string, number>;
  /** `instance:id` → when the item last made progress (only items stuck 30+ min). */
  stalled?: Record<string, string>;
  /** Real speeds from download clients, when any are set up. */
  clients?: { down: number; up: number };
  sampleIntervalMs: number;
}

export type CleanupAction = 'blocklist-search' | 'blocklist' | 'remove';

export interface CleanupEntry {
  id: string;
  at: string;
  instance: string;
  instanceName: string;
  kind: 'sonarr' | 'radarr';
  title: string;
  release: string;
  reason: string;
  action: CleanupAction;
  outcome: 'done' | 'failed' | 'preview';
  error?: string;
}

export interface CleanupStatus {
  settings: { enabled: boolean; stalledHours: number; failed: boolean; action: CleanupAction };
  actions: CleanupAction[];
  stallHours: number[];
  available: boolean;
  lastRun?: string;
  nextRun?: string;
  watching: number;
  pending: number;
  log: CleanupEntry[];
}

export interface NowPlaying {
  sessionId: string;
  /** Set for streams on an extra media server (its id, name and type). */
  server?: string;
  serverName?: string;
  serverType?: MediaServerType;
  user: { id?: string; name: string; imageTag?: string };
  client?: string;
  device?: string;
  appVersion?: string;
  remoteAddress?: string;
  lastActivity?: string;
  item: {
    id: string;
    type: string;
    mediaType?: string;
    title: string;
    seriesName?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    album?: string;
    artist?: string;
    year?: number;
    overview?: string;
    genres: string[];
    officialRating?: string;
    communityRating?: number;
    runtimeMs: number;
    resolution?: string;
    hdr?: string;
    videoCodec?: string;
    audio?: string;
    poster?: ArtworkRef;
    backdrop?: ArtworkRef;
    logo?: ArtworkRef;
    thumb?: ArtworkRef;
  };
  state: { positionMs: number; progress: number; isPaused: boolean; isMuted: boolean; playMethod: string };
  transcode?: {
    videoCodec?: string;
    audioCodec?: string;
    container?: string;
    bitrate?: number;
    resolution?: string;
    framerate?: number;
    isVideoDirect: boolean;
    isAudioDirect: boolean;
    completion?: number;
    hwAccel?: string;
    reasons: string[];
  };
}

export interface JellyfinOverview {
  /** `id` is set when this is an extra Jellyfin server. */
  server: { id?: string; name: string; version: string; os?: string; architecture?: string; hasUpdateAvailable: boolean; hasPendingRestart: boolean };
  counts: {
    movies: number;
    series: number;
    episodes: number;
    albums: number;
    songs: number;
    artists: number;
    books: number;
    musicVideos: number;
    collections: number;
  };
  libraries: {
    id: string;
    name: string;
    type: string;
    locations: string[];
    itemCount?: number;
    refreshing: boolean;
    refreshProgress?: number;
    image: ArtworkRef;
  }[];
  users: {
    total: number;
    active24h: number;
    list: { id: string; name: string; imageTag?: string; isAdmin: boolean; lastActivity?: string }[];
  };
  sessions: { active: number; streams: number; transcoding: number; directPlay: number };
}

export interface LatestItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  year?: number;
  added?: string;
  rating?: number;
  poster?: ArtworkRef;
  backdrop?: ArtworkRef;
  thumb?: ArtworkRef;
}

export interface ActivityEntry {
  id: number;
  name: string;
  overview?: string;
  type: string;
  date: string;
  severity: string;
  userId?: string;
}

export interface PlayDay {
  date: string;
  plays: number;
  users: number;
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

export interface SonarrOverview {
  stats: {
    series: number;
    monitored: number;
    continuing: number;
    ended: number;
    episodes: number;
    episodeFiles: number;
    sizeOnDisk: number;
    missing: number;
  };
  queue: { total: number; items: QueueItem[] };
  upcoming: UpcomingItem[];
  recent: { id: number; title: string; year?: number; network?: string; status: string; progress: number; poster?: string; tmdbId?: number }[];
  disks: DiskInfo[];
}

export interface RadarrOverview {
  stats: { movies: number; monitored: number; downloaded: number; missing: number; unreleased: number; sizeOnDisk: number };
  qualities: { name: string; count: number }[];
  queue: { total: number; items: QueueItem[] };
  upcoming: UpcomingItem[];
  recent: { id: number; title: string; year?: number; hasFile: boolean; poster?: string; tmdbId?: number }[];
  disks: DiskInfo[];
}

export interface Indexer {
  id: number;
  name: string;
  enabled: boolean;
  protocol: string;
  privacy?: string;
  priority?: number;
  implementation?: string;
  health: 'healthy' | 'failing' | 'disabled';
  disabledUntil?: string;
  lastFailure?: string;
  stats: {
    avgResponseMs: number;
    queries: number;
    grabs: number;
    rssQueries: number;
    authQueries: number;
    failedQueries: number;
    failedGrabs: number;
    successRate?: number;
  };
}

export interface ProwlarrOverview {
  summary: {
    total: number;
    enabled: number;
    healthy: number;
    failing: number;
    disabled: number;
    torrent: number;
    usenet: number;
    avgResponseMs: number;
    queries: number;
    grabs: number;
    failedQueries: number;
    failedGrabs: number;
  };
  indexers: Indexer[];
  applications: { id: number; name: string; type?: string; syncLevel?: string }[];
}

export interface SeerrRequest {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  status: 'pending' | 'approved' | 'declined' | 'failed' | 'completed' | 'unknown';
  mediaStatus: string;
  is4k: boolean;
  seasons: number[];
  requestedBy: string;
  modifiedBy?: string;
  createdAt: string;
  tmdbId?: number;
}

export interface SeerrOverview {
  counts: {
    total: number;
    movie: number;
    tv: number;
    pending: number;
    approved: number;
    declined: number;
    processing: number;
    available: number;
  };
  recent: SeerrRequest[];
  pending: SeerrRequest[];
}

export type DriveHealth = 'healthy' | 'warning' | 'critical' | 'offline' | 'unknown';
export interface Drive {
  id: string;
  name: string;
  mount?: string;
  filesystem?: string;
  total: number;
  used: number;
  free: number;
  usage: number;
  health: DriveHealth;
  healthDetail?: string;
  temperature?: number;
  readOnly?: boolean;
  source: 'remote' | 'local';
}

export interface InfinidiskOverview {
  drives: Drive[];
  totals: { total: number; used: number; free: number; usage: number };
  counts: { total: number; healthy: number; warning: number; critical: number; offline: number };
  version?: string;
  sources: { remote: boolean; local: number };
}

/* ------------------------------- settings ------------------------------- */

export type SettingsSource = 'database' | 'environment' | 'none';

export interface ServiceSettingsView {
  id: ServiceId;
  name: string;
  source: SettingsSource;
  configured: boolean;
  /** Disabled services keep their settings but are hidden and not polled. */
  enabled: boolean;
  canDisable: boolean;
  /** Whether environment variables exist to fall back to. */
  envAvailable: boolean;
  updatedAt?: string;
  updatedBy?: string;
  url: string;
  /** Where people open it in a browser; empty = same as `url`. */
  publicUrl: string;
  apiKeySet: boolean;
  apiKeyHint?: string;
  /** Infinidisk only. */
  authHeader?: string;
  statusPath?: string;
  healthPath?: string;
  mounts?: string[];
}

export type ArrKind = 'sonarr' | 'radarr';

/** Parts of the app a member can be given access to. */
export type Area = 'now-playing' | 'stats' | 'library' | 'system' | 'downloads' | 'requests' | ServiceId;

export interface MemberAccess {
  signIn: boolean;
  areas: Area[];
  available: Area[];
}

/** A Sonarr/Radarr instance as listed in /api/config. */
export interface ArrInstanceRef {
  id: string;
  kind: ArrKind;
  name: string;
  primary: boolean;
}

export type MediaServerType = 'jellyfin' | 'emby' | 'plex';

/** A media server as listed in /api/config (only when there are several). */
export interface JellyfinServerRef {
  id: string;
  type: MediaServerType;
  name: string;
  primary: boolean;
}

/** An extra media server (Jellyfin, Emby or Plex) as shown on the Settings page. */
export interface MediaServerView {
  id: string;
  type: MediaServerType;
  /** The server people sign in with (can't be switched off or removed). */
  main?: boolean;
  name: string;
  url: string;
  publicUrl: string;
  enabled: boolean;
  apiKeySet: boolean;
  apiKeyHint?: string;
  createdAt: string;
}

/** A media server found on the local network. */
export interface DiscoveredServer {
  id: string;
  /** Settings discovery only; the first-run search lists Jellyfin servers. */
  type?: MediaServerType;
  name: string;
  url: string;
  version?: string;
  reachable: boolean;
  /** Settings only: already the main server or an extra one. */
  added?: boolean;
}

/** An extra instance as shown on the Settings page. */
export interface ArrInstanceView {
  id: string;
  kind: ArrKind;
  name: string;
  url: string;
  enabled: boolean;
  apiKeySet: boolean;
  apiKeyHint?: string;
  createdAt: string;
}

export interface ServiceSettingsInput {
  url?: string;
  publicUrl?: string;
  /** Omit to keep the saved key; empty string removes it. */
  apiKey?: string;
  authHeader?: string;
  statusPath?: string;
  healthPath?: string;
  mounts?: string[];
}

export type ConnectionTest =
  | { ok: true; version?: string; latencyMs: number; issues: HealthIssue[] }
  | { ok: false; message: string };

/* ------------------------------ auto-import ------------------------------ */

export type AutoImportMethod = 'sonarr' | 'radarr' | 'grab-history' | 'parser' | 'title-match' | 'numbering';
export type AutoImportOutcome = 'imported' | 'queued' | 'skipped' | 'failed' | 'preview';

export interface AutoImportFile {
  name: string;
  /** Series or movie title. */
  title?: string;
  /** Episode range or movie year. */
  detail?: string;
  titleMethod?: AutoImportMethod;
  detailMethod?: AutoImportMethod;
  ok: boolean;
  reason?: string;
}

export interface AutoImportEntry {
  id: string;
  at: string;
  trigger: 'schedule' | 'queue' | 'manual';
  instance: string;
  instanceName?: string;
  title: string;
  release: string;
  outcome: AutoImportOutcome;
  message: string;
  files: AutoImportFile[];
}

export interface AutoImportStatus {
  settings: { enabled: boolean; intervalMinutes: number };
  intervals: number[];
  running: boolean;
  lastRun?: string;
  lastError?: string;
  nextRun?: string;
  stuck: number;
  log: AutoImportEntry[];
}

/* ------------------------------ notifications ----------------------------- */

export type NotifyEvent = 'service_down' | 'service_up' | 'disk_low' | 'import_done' | 'import_failed' | 'download_removed' | 'request_pending' | 'playback_alert' | 'weekly_digest' | 'rule' | 'update_available';
export type ChannelType = 'discord' | 'ntfy' | 'pushover' | 'webhook' | 'webpush';

export interface NotifyChannel {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: NotifyEvent[];
  /** Non-secret fields. */
  config: Record<string, string>;
  /** Hints for saved secret fields (undefined = not set). */
  secrets: Record<string, string | undefined>;
}

export interface ChannelInput {
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: NotifyEvent[];
  /** Omit a secret field to keep the saved value. */
  config: Record<string, string>;
}

export interface NotificationsStatus {
  channels: NotifyChannel[];
  events: NotifyEvent[];
  defaultEvents: NotifyEvent[];
  deliveries: { at: string; channel: string; event: NotifyEvent | 'test'; title: string; ok: boolean; error?: string }[];
  push: { publicKey: string; devices: number };
  publicUrl: string;
}

export interface MissingItem {
  id: number;
  title: string;
  subtitle?: string;
  date?: string;
  poster?: string;
  tmdbId?: number;
}
export interface MissingPage {
  total: number;
  page: number;
  pageSize: number;
  items: MissingItem[];
}

export interface PlaybackStats {
  days: number;
  source: 'recorder' | 'activity' | 'mixed';
  recording: boolean;
  recordingSince?: string;
  totals: { plays: number; hours?: number; users: number; transcodeShare?: number };
  daily: { date: string; plays: number; direct: number; transcode: number; hours: number }[];
  /** [weekday Mon..Sun][hour 0..23] → plays started. */
  heatmap: number[][];
  topUsers: { name: string; plays: number; hours: number }[];
  topTitles: { name: string; plays: number; hours: number }[];
  topClients: { name: string; plays: number; hours: number }[];
}

export interface StorageForecast {
  alertPercent: number;
  volumes: {
    key: string;
    label: string;
    used: number;
    total: number;
    usage: number;
    since: string;
    /** Bytes per day; undefined until there's a day of history. */
    growthPerDay?: number;
    daysLeft?: number;
    fullOn?: string;
    history: { t: number; used: number }[];
  }[];
}

export interface LibraryHealthItem {
  title: string;
  year?: number;
  detail: string;
  instance?: string;
  instanceName?: string;
  poster?: string;
}
type Section = { total: number; items: LibraryHealthItem[] };
export interface LibraryHealth {
  checkedAt: string;
  hasSonarr: boolean;
  hasRadarr: boolean;
  hasJellyfin: boolean;
  /** What the cross-checks compare with: "Plex", "Jellyfin", "Emby", or "your media servers". */
  server?: string;
  /** Media servers that couldn't be read this time. */
  unreachable?: string[];
  incomplete?: Section;
  upgrades: { instance: string; instanceName?: string; kind: ArrKind; name: string; count: number }[];
  notInJellyfin?: Section;
  unmanaged?: Section;
}

export const CLIENT_TYPES = ['qbittorrent', 'transmission', 'sabnzbd', 'nzbget'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export interface ClientConfig {
  id: string;
  type: ClientType;
  name: string;
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
  enabled: boolean;
  createdAt: string;
}

export type ItemState = 'downloading' | 'seeding' | 'paused' | 'queued' | 'checking' | 'stalled' | 'completed' | 'error';

export interface ClientItem {
  id: string;
  name: string;
  state: ItemState;
  /** 0–1. */
  progress: number;
  size: number;
  downloaded: number;
  downSpeed: number;
  upSpeed: number;
  /** Seconds, when known. */
  eta?: number;
  ratio?: number;
  category?: string;
  addedAt?: string;
  error?: string;
}

export interface ClientSnapshot {
  version?: string;
  protocol: 'torrent' | 'usenet';
  downSpeed: number;
  upSpeed: number;
  /** Bytes/s; 0 or undefined = unlimited. */
  downLimit?: number;
  upLimit?: number;
  paused: boolean;
  freeSpace?: number;
  items: ClientItem[];
}

export type ItemAction = 'pause' | 'resume' | 'remove' | 'remove-data';

export interface ClientAdapter {
  version(): Promise<string | undefined>;
  snapshot(): Promise<ClientSnapshot>;
  setPaused(paused: boolean): Promise<void>;
  item(id: string, action: ItemAction): Promise<void>;
  /** Bytes/s, 0 = unlimited. `up` is ignored by usenet clients. */
  setLimits(down: number, up: number): Promise<void>;
}

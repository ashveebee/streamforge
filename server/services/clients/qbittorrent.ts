import { config } from '../../config.js';
import { buildUrl, requestRaw, UpstreamError } from '../../lib/http.js';
import type { ClientAdapter, ClientConfig, ClientItem, ItemState } from './types.js';

/* qBittorrent Web API v2. Uses an API key when given (5.2+), else signs in with a cookie and re-signs in when it expires. */

const STATES: Record<string, ItemState> = {
  downloading: 'downloading',
  forcedDL: 'downloading',
  metaDL: 'downloading',
  forcedMetaDL: 'downloading',
  allocating: 'downloading',
  uploading: 'seeding',
  forcedUP: 'seeding',
  stalledUP: 'seeding',
  stalledDL: 'stalled',
  pausedDL: 'paused',
  stoppedDL: 'paused',
  pausedUP: 'completed',
  stoppedUP: 'completed',
  queuedDL: 'queued',
  queuedUP: 'queued',
  checkingDL: 'checking',
  checkingUP: 'checking',
  checkingResumeData: 'checking',
  moving: 'checking',
  error: 'error',
  missingFiles: 'error',
};

interface Torrent {
  name: string;
  state: string;
  progress: number;
  size: number;
  downloaded: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  category?: string;
  added_on: number;
}

interface ServerState {
  dl_info_speed?: number;
  up_info_speed?: number;
  dl_rate_limit?: number;
  up_rate_limit?: number;
  free_space_on_disk?: number;
}

/** A `sync/maindata` response. After the first, only what changed since `rid` is included. */
export interface MainData {
  rid: number;
  full_update?: boolean;
  torrents?: Record<string, Partial<Torrent>>;
  torrents_removed?: string[];
  server_state?: ServerState;
}

/*
 * Keeps the torrent list in step with qBittorrent through `sync/maindata`, so
 * after the first call each sample carries only what changed instead of the
 * whole library. One call covers torrents, speeds, limits and free space.
 */
export class MainDataSync {
  rid = 0;
  torrents = new Map<string, Partial<Torrent>>();
  server: ServerState = {};

  apply(d: MainData) {
    if (d.full_update || this.rid === 0) {
      this.torrents.clear();
      this.server = {};
    }
    for (const [hash, patch] of Object.entries(d.torrents ?? {})) this.torrents.set(hash, { ...this.torrents.get(hash), ...patch });
    for (const hash of d.torrents_removed ?? []) this.torrents.delete(hash);
    Object.assign(this.server, d.server_state);
    this.rid = d.rid;
  }

  reset() {
    this.rid = 0;
    this.torrents.clear();
    this.server = {};
  }
}

/* The first sync returns every torrent, which takes a while on a large library. Only one is ever in flight, so waiting is safe. */
const SYNC_TIMEOUT_MS = Math.max(config.requestTimeoutMs, 60_000);

/*
 * qBittorrent 5.2 names the session cookie `QBT_SID_<port>`; older versions use `SID`.
 * Returns the name and value so the same cookie can be sent back.
 */
export function parseSessionCookie(setCookies: string[]): { name: string; value: string } | undefined {
  for (const line of setCookies) {
    const m = line.match(/^\s*(QBT_SID_\d+|SID)=([^;]*)/);
    if (m?.[2]) return { name: m[1]!, value: m[2] };
  }
  return undefined;
}

export function qbittorrent(c: ClientConfig): ClientAdapter {
  /* undefined = not signed in yet; null = signed in without a cookie (authentication bypass). */
  let session: { name: string; value: string } | null | undefined;
  const origin = new URL(c.url).origin;
  const apiKey = c.apiKey?.trim();
  const hasLogin = !!(c.username || c.password);

  async function login() {
    const res = await requestRaw(buildUrl(c.url, '/api/v2/auth/login'), {
      method: 'POST',
      service: 'qbittorrent',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: origin, Origin: origin },
      rawBody: new URLSearchParams({ username: c.username ?? '', password: c.password ?? '' }).toString(),
    });
    const text = (await res.text()).trim();
    if (res.status === 403 && /banned/i.test(text)) throw new UpstreamError(text, 403, 'qbittorrent');
    if (!res.ok || text === 'Fails.') {
      throw new UpstreamError(
        hasLogin ? 'Sign-in failed — check the username and password' : 'qBittorrent needs a username and password or an API key — StreamForge’s address isn’t covered by its authentication bypass',
        401,
        'qbittorrent',
      );
    }
    // Authentication bypass may answer without a cookie; requests still work.
    session = parseSessionCookie(res.headers.getSetCookie()) ?? null;
  }

  async function call(path: string, form?: Record<string, string>, retry = true, timeoutMs?: number): Promise<string> {
    if (!apiKey && session === undefined) await login();
    const res = await requestRaw(buildUrl(c.url, path), {
      method: form ? 'POST' : 'GET',
      service: 'qbittorrent',
      headers: {
        Referer: origin,
        Origin: origin,
        ...(apiKey ? { 'X-API-Key': apiKey } : session ? { Cookie: `${session.name}=${session.value}` } : {}),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      rawBody: form ? new URLSearchParams(form).toString() : undefined,
      timeoutMs,
    });
    if (apiKey && res.status === 401) throw new UpstreamError('API key rejected — check it in qBittorrent’s Web UI settings', 401, 'qbittorrent');
    if (!apiKey && res.status === 403) {
      if (retry) {
        session = undefined;
        return call(path, form, false, timeoutMs);
      }
      throw new UpstreamError(
        hasLogin ? 'qBittorrent rejected the session (HTTP 403)' : 'qBittorrent needs a username and password or an API key — StreamForge’s address isn’t covered by its authentication bypass',
        403,
        'qbittorrent',
      );
    }
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status, 'qbittorrent');
    return res.text();
  }
  const sync = new MainDataSync();
  /* The version doesn't change while qBittorrent runs; it's asked again after a failure in case it was upgraded. */
  let version: string | undefined;

  /* qBittorrent 5 renamed pause/resume to stop/start. */
  async function either(newPath: string, oldPath: string, form: Record<string, string>) {
    try {
      await call(newPath, form);
    } catch (err) {
      if ((err as UpstreamError).status === 404) await call(oldPath, form);
      else throw err;
    }
  }

  return {
    version: async () => (await call('/api/v2/app/version')).trim(),
    async snapshot() {
      try {
        version ??= (await call('/api/v2/app/version')).trim();
        sync.apply(JSON.parse(await call(`/api/v2/sync/maindata?rid=${sync.rid}`, undefined, true, SYNC_TIMEOUT_MS)) as MainData);
      } catch (err) {
        version = undefined;
        sync.reset();
        throw err;
      }
      const items: ClientItem[] = [];
      for (const [hash, t] of sync.torrents) {
        const eta = t.eta ?? 0;
        items.push({
          id: hash,
          name: t.name ?? hash,
          state: STATES[t.state ?? ''] ?? 'queued',
          progress: t.progress ?? 0,
          size: t.size ?? 0,
          downloaded: t.downloaded ?? 0,
          downSpeed: t.dlspeed ?? 0,
          upSpeed: t.upspeed ?? 0,
          eta: eta > 0 && eta < 8_640_000 ? eta : undefined,
          ratio: t.ratio,
          category: t.category || undefined,
          addedAt: t.added_on ? new Date(t.added_on * 1000).toISOString() : undefined,
        });
      }
      const st = sync.server;
      return {
        version,
        protocol: 'torrent' as const,
        downSpeed: st.dl_info_speed ?? 0,
        upSpeed: st.up_info_speed ?? 0,
        downLimit: st.dl_rate_limit || undefined,
        upLimit: st.up_rate_limit || undefined,
        paused: items.length > 0 && items.every((i) => i.state === 'paused' || i.state === 'completed'),
        freeSpace: st.free_space_on_disk,
        items,
      };
    },
    setPaused: (paused) => either(paused ? '/api/v2/torrents/stop' : '/api/v2/torrents/start', paused ? '/api/v2/torrents/pause' : '/api/v2/torrents/resume', { hashes: 'all' }),
    async item(id, action) {
      if (action === 'pause') return either('/api/v2/torrents/stop', '/api/v2/torrents/pause', { hashes: id });
      if (action === 'resume') return either('/api/v2/torrents/start', '/api/v2/torrents/resume', { hashes: id });
      await call('/api/v2/torrents/delete', { hashes: id, deleteFiles: String(action === 'remove-data') });
    },
    async setLimits(down, up) {
      await call('/api/v2/transfer/setDownloadLimit', { limit: String(Math.max(0, Math.round(down))) });
      await call('/api/v2/transfer/setUploadLimit', { limit: String(Math.max(0, Math.round(up))) });
    },
  };
}

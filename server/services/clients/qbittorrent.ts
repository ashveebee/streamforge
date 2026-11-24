import { buildUrl, requestRaw, UpstreamError } from '../../lib/http.js';
import type { ClientAdapter, ClientConfig, ClientItem, ItemState } from './types.js';

/* qBittorrent Web API v2. Signs in with a cookie and re-signs in when it expires. */

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
  hash: string;
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

export function qbittorrent(c: ClientConfig): ClientAdapter {
  let sid: string | undefined;
  const origin = new URL(c.url).origin;

  async function login() {
    const res = await requestRaw(buildUrl(c.url, '/api/v2/auth/login'), {
      method: 'POST',
      service: 'qbittorrent',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: origin, Origin: origin },
      rawBody: new URLSearchParams({ username: c.username ?? '', password: c.password ?? '' }).toString(),
    });
    const text = await res.text();
    const cookie = res.headers.get('set-cookie')?.match(/SID=([^;]+)/)?.[1];
    if (!res.ok || text.trim() === 'Fails.') throw new UpstreamError('Sign-in failed — check the username and password', 401, 'qbittorrent');
    // Local-network bypass: no cookie, but requests work anyway.
    sid = cookie ?? '';
  }

  async function call(path: string, form?: Record<string, string>, retry = true): Promise<string> {
    if (sid === undefined) await login();
    const res = await requestRaw(buildUrl(c.url, path), {
      method: form ? 'POST' : 'GET',
      service: 'qbittorrent',
      headers: {
        Referer: origin,
        Origin: origin,
        ...(sid ? { Cookie: `SID=${sid}` } : {}),
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      rawBody: form ? new URLSearchParams(form).toString() : undefined,
    });
    if (res.status === 403 && retry) {
      sid = undefined;
      return call(path, form, false);
    }
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status, 'qbittorrent');
    return res.text();
  }
  const json = async <T>(path: string) => JSON.parse(await call(path)) as T;

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
      const [version, info, torrents, main] = await Promise.all([
        call('/api/v2/app/version'),
        json<{ dl_info_speed: number; up_info_speed: number; dl_rate_limit: number; up_rate_limit: number }>('/api/v2/transfer/info'),
        json<Torrent[]>('/api/v2/torrents/info'),
        json<{ server_state?: { free_space_on_disk?: number } }>('/api/v2/sync/maindata').catch(() => ({}) as { server_state?: { free_space_on_disk?: number } }),
      ]);
      const items: ClientItem[] = torrents.map((t) => ({
        id: t.hash,
        name: t.name,
        state: STATES[t.state] ?? 'queued',
        progress: t.progress,
        size: t.size,
        downloaded: t.downloaded,
        downSpeed: t.dlspeed,
        upSpeed: t.upspeed,
        eta: t.eta > 0 && t.eta < 8_640_000 ? t.eta : undefined,
        ratio: t.ratio,
        category: t.category || undefined,
        addedAt: new Date(t.added_on * 1000).toISOString(),
      }));
      return {
        version: version.trim(),
        protocol: 'torrent' as const,
        downSpeed: info.dl_info_speed,
        upSpeed: info.up_info_speed,
        downLimit: info.dl_rate_limit || undefined,
        upLimit: info.up_rate_limit || undefined,
        paused: items.length > 0 && items.every((i) => i.state === 'paused' || i.state === 'completed'),
        freeSpace: main.server_state?.free_space_on_disk,
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

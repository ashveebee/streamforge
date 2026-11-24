import { buildUrl, requestRaw, UpstreamError } from '../../lib/http.js';
import type { ClientAdapter, ClientConfig, ItemState } from './types.js';

/* Transmission RPC. Handles the X-Transmission-Session-Id handshake. */

const STATUS: Record<number, ItemState> = { 0: 'paused', 1: 'checking', 2: 'checking', 3: 'queued', 4: 'downloading', 5: 'queued', 6: 'seeding' };

interface Torrent {
  id: number;
  hashString: string;
  name: string;
  status: number;
  percentDone: number;
  totalSize: number;
  downloadedEver: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  uploadRatio: number;
  addedDate: number;
  labels?: string[];
  error: number;
  errorString?: string;
}

export function transmission(c: ClientConfig): ClientAdapter {
  let session = '';
  const url = buildUrl(c.url, c.url.includes('/transmission') ? '' : '/transmission/rpc').replace(/\/$/, '');
  const auth: Record<string, string> = c.username ? { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64')}` } : {};

  async function rpc<T>(method: string, args: Record<string, unknown> = {}, retry = true): Promise<T> {
    const res = await requestRaw(url, {
      method: 'POST',
      service: 'transmission',
      headers: { ...auth, 'X-Transmission-Session-Id': session, 'Content-Type': 'application/json' },
      rawBody: JSON.stringify({ method, arguments: args }),
    });
    if (res.status === 409 && retry) {
      session = res.headers.get('x-transmission-session-id') ?? '';
      return rpc(method, args, false);
    }
    if (res.status === 401) throw new UpstreamError('Unauthorised — check the username and password', 401, 'transmission');
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status, 'transmission');
    const body = (await res.json()) as { result: string; arguments: T };
    if (body.result !== 'success') throw new UpstreamError(body.result, undefined, 'transmission');
    return body.arguments;
  }

  type Session = { version: string; 'speed-limit-down': number; 'speed-limit-down-enabled': boolean; 'speed-limit-up': number; 'speed-limit-up-enabled': boolean; 'download-dir': string };
  const ids = (id: string) => [/^\d+$/.test(id) ? Number(id) : id];

  return {
    version: async () => (await rpc<Session>('session-get', { fields: ['version'] })).version,
    async snapshot() {
      const [s, stats, list] = await Promise.all([
        rpc<Session>('session-get'),
        rpc<{ downloadSpeed: number; uploadSpeed: number }>('session-stats'),
        rpc<{ torrents: Torrent[] }>('torrent-get', {
          fields: ['id', 'hashString', 'name', 'status', 'percentDone', 'totalSize', 'downloadedEver', 'rateDownload', 'rateUpload', 'eta', 'uploadRatio', 'addedDate', 'labels', 'error', 'errorString'],
        }),
      ]);
      const free = await rpc<{ 'size-bytes': number }>('free-space', { path: s['download-dir'] }).catch(() => undefined);
      const items = list.torrents.map((t) => ({
        id: t.hashString,
        name: t.name,
        state: t.error ? ('error' as const) : t.status === 0 && t.percentDone >= 1 ? ('completed' as const) : (STATUS[t.status] ?? ('queued' as const)),
        progress: t.percentDone,
        size: t.totalSize,
        downloaded: t.downloadedEver,
        downSpeed: t.rateDownload,
        upSpeed: t.rateUpload,
        eta: t.eta > 0 ? t.eta : undefined,
        ratio: t.uploadRatio >= 0 ? t.uploadRatio : undefined,
        category: t.labels?.[0],
        addedAt: new Date(t.addedDate * 1000).toISOString(),
        error: t.error ? t.errorString : undefined,
      }));
      return {
        version: s.version,
        protocol: 'torrent' as const,
        downSpeed: stats.downloadSpeed,
        upSpeed: stats.uploadSpeed,
        // Transmission limits are in kB/s.
        downLimit: s['speed-limit-down-enabled'] ? s['speed-limit-down'] * 1000 : undefined,
        upLimit: s['speed-limit-up-enabled'] ? s['speed-limit-up'] * 1000 : undefined,
        paused: items.length > 0 && items.every((i) => i.state === 'paused' || i.state === 'completed'),
        freeSpace: free?.['size-bytes'],
        items,
      };
    },
    setPaused: (paused) => rpc(paused ? 'torrent-stop' : 'torrent-start').then(() => undefined),
    async item(id, action) {
      if (action === 'pause') await rpc('torrent-stop', { ids: ids(id) });
      else if (action === 'resume') await rpc('torrent-start', { ids: ids(id) });
      else await rpc('torrent-remove', { ids: ids(id), 'delete-local-data': action === 'remove-data' });
    },
    async setLimits(down, up) {
      await rpc('session-set', {
        'speed-limit-down-enabled': down > 0,
        'speed-limit-up-enabled': up > 0,
        ...(down > 0 ? { 'speed-limit-down': Math.max(1, Math.round(down / 1000)) } : {}),
        ...(up > 0 ? { 'speed-limit-up': Math.max(1, Math.round(up / 1000)) } : {}),
      });
    },
  };
}

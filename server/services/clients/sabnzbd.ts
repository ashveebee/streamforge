import { buildUrl, requestJson } from '../../lib/http.js';
import type { ClientAdapter, ClientConfig, ItemState } from './types.js';

/* SABnzbd JSON API. */

interface Slot {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  mb: string;
  mbleft: string;
  timeleft?: string;
  cat?: string;
}
interface Queue {
  queue: {
    status: string;
    paused: boolean;
    kbpersec: string;
    speedlimit_abs?: string;
    diskspace1?: string;
    slots: Slot[];
  };
}

const STATE: Record<string, ItemState> = { Downloading: 'downloading', Paused: 'paused', Queued: 'queued', Grabbing: 'queued', Fetching: 'queued', Checking: 'checking', Propagating: 'queued' };
const MB = 1024 * 1024;

const seconds = (t?: string) => {
  const m = t?.match(/^(?:(\d+):)?(\d+):(\d+):(\d+)$/);
  if (!m) return undefined;
  return (Number(m[1] ?? 0) * 86_400) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
};

export function sabnzbd(c: ClientConfig): ClientAdapter {
  const api = <T>(query: Record<string, string>) =>
    requestJson<T>(buildUrl(c.url, '/api', { ...query, output: 'json', apikey: c.apiKey ?? '' }), { service: 'sabnzbd' }).then((r) => {
      const err = (r as { error?: string; status?: boolean }).error;
      if (err) throw new Error(err);
      return r;
    });
  return {
    version: async () => (await api<{ version: string }>({ mode: 'version' })).version,
    async snapshot() {
      const [{ version }, { queue: q }] = await Promise.all([api<{ version: string }>({ mode: 'version' }), api<Queue>({ mode: 'queue', limit: '200' })]);
      const items = q.slots.map((s) => {
        const size = Number(s.mb) * MB;
        const left = Number(s.mbleft) * MB;
        return {
          id: s.nzo_id,
          name: s.filename,
          state: STATE[s.status] ?? ('queued' as const),
          progress: Number(s.percentage) / 100,
          size,
          downloaded: size - left,
          downSpeed: 0,
          upSpeed: 0,
          eta: seconds(s.timeleft),
          category: s.cat && s.cat !== '*' ? s.cat : undefined,
        };
      });
      const speed = Number(q.kbpersec) * 1024;
      // SABnzbd reports only the total speed; credit it to the active item.
      const active = items.find((i) => i.state === 'downloading');
      if (active) active.downSpeed = speed;
      const limit = Number(q.speedlimit_abs);
      return {
        version,
        protocol: 'usenet' as const,
        downSpeed: speed,
        upSpeed: 0,
        downLimit: limit > 0 ? limit : undefined,
        paused: q.paused,
        freeSpace: q.diskspace1 ? Number(q.diskspace1) * 1024 ** 3 : undefined,
        items,
      };
    },
    setPaused: (paused) => api({ mode: paused ? 'pause' : 'resume' }).then(() => undefined),
    async item(id, action) {
      if (action === 'pause' || action === 'resume') await api({ mode: 'queue', name: action, value: id });
      else await api({ mode: 'queue', name: 'delete', value: id, del_files: action === 'remove-data' ? '1' : '0' });
    },
    // 100% of the configured maximum is "no limit"; absolute values take a K suffix.
    setLimits: (down) => api({ mode: 'config', name: 'speedlimit', value: down > 0 ? `${Math.max(1, Math.round(down / 1024))}K` : '100' }).then(() => undefined),
  };
}

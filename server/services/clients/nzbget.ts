import { buildUrl, requestJson } from '../../lib/http.js';
import type { ClientAdapter, ClientConfig, ClientItem, ItemState } from './types.js';

/* NZBGet JSON-RPC. */

interface Group {
  NZBID: number;
  NZBName: string;
  Status: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  Category?: string;
  MinPostTime?: number;
}
interface Status {
  DownloadRate: number;
  DownloadLimit: number;
  DownloadPaused: boolean;
  FreeDiskSpaceMB: number;
}

const MB = 1024 * 1024;

const state = (s: string): ItemState =>
  s === 'DOWNLOADING' ? 'downloading' : s === 'PAUSED' ? 'paused' : s.startsWith('PP_') || ['LOADING_PARS', 'VERIFYING_SOURCES', 'REPAIRING', 'VERIFYING_REPAIRED', 'RENAMING', 'UNPACKING', 'MOVING', 'EXECUTING_SCRIPT'].includes(s) ? 'checking' : 'queued';

export function nzbget(c: ClientConfig): ClientAdapter {
  const headers = { Authorization: `Basic ${Buffer.from(`${c.username ?? ''}:${c.password ?? ''}`).toString('base64')}` };
  const rpc = async <T>(method: string, params: unknown[] = []) =>
    (await requestJson<{ result: T; error?: { message: string } }>(buildUrl(c.url, '/jsonrpc'), { method: 'POST', body: { method, params }, headers, service: 'nzbget' })).result;
  const edit = (command: string, id: string) => rpc<boolean>('editqueue', [command, '', [Number(id)]]);

  return {
    version: () => rpc<string>('version'),
    async snapshot() {
      const [version, s, groups] = await Promise.all([rpc<string>('version'), rpc<Status>('status'), rpc<Group[]>('listgroups', [0])]);
      const items: ClientItem[] = groups.map((g) => ({
        id: String(g.NZBID),
        name: g.NZBName,
        state: state(g.Status),
        progress: g.FileSizeMB > 0 ? 1 - g.RemainingSizeMB / g.FileSizeMB : 0,
        size: g.FileSizeMB * MB,
        downloaded: (g.FileSizeMB - g.RemainingSizeMB) * MB,
        downSpeed: 0,
        upSpeed: 0,
        category: g.Category || undefined,
      }));
      const active = items.find((i) => i.state === 'downloading');
      if (active) active.downSpeed = s.DownloadRate;
      const left = items.reduce((n, i) => n + i.size - i.downloaded, 0);
      if (active && s.DownloadRate > 0) active.eta = Math.round(left / s.DownloadRate);
      return {
        version,
        protocol: 'usenet' as const,
        downSpeed: s.DownloadRate,
        upSpeed: 0,
        downLimit: s.DownloadLimit || undefined,
        paused: s.DownloadPaused,
        freeSpace: s.FreeDiskSpaceMB * MB,
        items,
      };
    },
    setPaused: (paused) => rpc(paused ? 'pausedownload' : 'resumedownload').then(() => undefined),
    async item(id, action) {
      if (action === 'pause') await edit('GroupPause', id);
      else if (action === 'resume') await edit('GroupResume', id);
      else await edit(action === 'remove-data' ? 'GroupFinalDelete' : 'GroupDelete', id);
    },
    setLimits: (down) => rpc('rate', [Math.round(down / 1024)]).then(() => undefined),
  };
}

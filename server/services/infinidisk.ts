import { statfs, access, constants } from 'node:fs/promises';
import { config } from '../config.js';
import { createClient } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import type { HealthIssue, HealthProbe } from './types.js';

/**
 * Infinidisk storage integration.
 *
 * Two sources are supported and can be combined:
 *  1. Remote — `INFINIDISK_URL` + `INFINIDISK_STATUS_PATH` returning JSON.
 *     The response is normalised defensively (see `normaliseRemote`) so it works
 *     with the common shapes storage daemons expose: an array of drives/disks/
 *     mounts/volumes/pools, each with size/used/free (bytes) and a health field.
 *  2. Local — `INFINIDISK_MOUNTS` lists paths visible to the StreamForge backend
 *     (e.g. the Infinidisk mount points). These are measured with statfs().
 */

const cfg = config.infinidisk;
export const infinidiskConfigured = !!cfg.baseUrl || cfg.mounts.length > 0;

const client = cfg.baseUrl
  ? createClient('infinidisk', cfg.baseUrl, cfg.apiKey ? { [cfg.authHeader]: cfg.apiKey } : {})
  : undefined;

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

type Json = Record<string, unknown>;
const ARRAY_KEYS = ['drives', 'disks', 'mounts', 'volumes', 'pools', 'storage', 'devices', 'data', 'items'];

function pick<T = unknown>(o: Json, keys: string[]): T | undefined {
  for (const k of keys) {
    const hit = Object.keys(o).find((ok) => ok.toLowerCase() === k.toLowerCase());
    if (hit !== undefined && o[hit] !== undefined && o[hit] !== null) return o[hit] as T;
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function mapHealth(raw: unknown, usage: number): { health: DriveHealth; detail?: string } {
  const s = typeof raw === 'string' ? raw.toLowerCase() : typeof raw === 'boolean' ? (raw ? 'ok' : 'failed') : '';
  let health: DriveHealth = 'unknown';
  if (/^(ok|healthy|good|online|passed|active|mounted|up|ready)$/.test(s)) health = 'healthy';
  else if (/(warn|degraded|rebuild|resync|scrub)/.test(s)) health = 'warning';
  else if (/(fail|error|critical|faulted|bad)/.test(s)) health = 'critical';
  else if (/(offline|unmounted|missing|down|unavailable)/.test(s)) health = 'offline';
  else if (!s) health = 'healthy';
  if (health === 'healthy' && usage >= 0.95) return { health: 'critical', detail: 'Almost full' };
  if (health === 'healthy' && usage >= 0.88) return { health: 'warning', detail: 'Running low on space' };
  return { health, detail: typeof raw === 'string' ? raw : undefined };
}

function findArray(o: unknown, depth = 0): Json[] | undefined {
  if (Array.isArray(o)) return o.filter((x): x is Json => !!x && typeof x === 'object');
  if (!o || typeof o !== 'object' || depth > 2) return undefined;
  for (const k of ARRAY_KEYS) {
    const v = pick(o as Json, [k]);
    const arr = findArray(v, depth + 1);
    if (arr?.length) return arr;
  }
  return undefined;
}

export function normaliseRemote(payload: unknown): Drive[] {
  const arr = findArray(payload) ?? [];
  return arr.map((d, i) => {
    const total = num(pick(d, ['total', 'size', 'capacity', 'totalBytes', 'total_bytes', 'totalSpace', 'sizeBytes'])) ?? 0;
    let free = num(pick(d, ['free', 'available', 'avail', 'freeBytes', 'free_bytes', 'freeSpace', 'availableBytes']));
    let used = num(pick(d, ['used', 'usedBytes', 'used_bytes', 'usedSpace']));
    if (used === undefined && free !== undefined) used = Math.max(0, total - free);
    if (free === undefined && used !== undefined) free = Math.max(0, total - used);
    used ??= 0;
    free ??= 0;
    const usage = total > 0 ? used / total : 0;
    const { health, detail } = mapHealth(pick(d, ['health', 'status', 'state', 'smart', 'healthy']), usage);
    const name = String(pick(d, ['name', 'label', 'id', 'device', 'serial']) ?? `Drive ${i + 1}`);
    return {
      id: String(pick(d, ['id', 'uuid', 'serial', 'device', 'name']) ?? i),
      name,
      mount: pick<string>(d, ['mount', 'mountpoint', 'mountPoint', 'path', 'target']),
      filesystem: pick<string>(d, ['fs', 'filesystem', 'fstype', 'type']),
      total,
      used,
      free,
      usage,
      health,
      healthDetail: detail,
      temperature: num(pick(d, ['temperature', 'temp', 'tempC'])),
      readOnly: pick<boolean>(d, ['readOnly', 'readonly', 'ro']),
      source: 'remote' as const,
    };
  });
}

async function localDrives(): Promise<Drive[]> {
  return Promise.all(
    cfg.mounts.map(async (mount): Promise<Drive> => {
      try {
        const s = await statfs(mount);
        const total = s.blocks * s.bsize;
        const free = s.bavail * s.bsize;
        const used = total - s.bfree * s.bsize;
        const writable = await access(mount, constants.W_OK).then(() => true, () => false);
        const usage = total > 0 ? used / total : 0;
        const { health, detail } = mapHealth('ok', usage);
        return {
          id: mount,
          name: mount.split('/').filter(Boolean).pop() ?? mount,
          mount,
          total,
          used,
          free,
          usage,
          health,
          healthDetail: detail,
          readOnly: !writable,
          source: 'local',
        };
      } catch (err) {
        return {
          id: mount,
          name: mount.split('/').filter(Boolean).pop() ?? mount,
          mount,
          total: 0,
          used: 0,
          free: 0,
          usage: 0,
          health: 'offline',
          healthDetail: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'Mount not found' : (err as Error).message,
          source: 'local',
        };
      }
    }),
  );
}

async function remoteDrives() {
  if (!client) return { drives: [] as Drive[], raw: undefined as unknown };
  const raw = await client.get<unknown>(cfg.statusPath);
  return { drives: normaliseRemote(raw), raw };
}

export async function infinidiskOverview() {
  return cache.get('infinidisk:overview', 10_000, async () => {
    const [remote, local] = await Promise.all([remoteDrives(), localDrives()]);
    const drives = [...remote.drives, ...local];
    const totals = drives.reduce(
      (a, d) => {
        a.total += d.total;
        a.used += d.used;
        a.free += d.free;
        return a;
      },
      { total: 0, used: 0, free: 0 },
    );
    const rawObj = remote.raw && typeof remote.raw === 'object' && !Array.isArray(remote.raw) ? (remote.raw as Json) : {};
    return {
      drives,
      totals: { ...totals, usage: totals.total > 0 ? totals.used / totals.total : 0 },
      counts: {
        total: drives.length,
        healthy: drives.filter((d) => d.health === 'healthy').length,
        warning: drives.filter((d) => d.health === 'warning').length,
        critical: drives.filter((d) => d.health === 'critical').length,
        offline: drives.filter((d) => d.health === 'offline').length,
      },
      version: pick<string>(rawObj, ['version']),
      sources: { remote: !!client, local: cfg.mounts.length },
    };
  });
}

export async function infinidiskProbe(): Promise<HealthProbe> {
  if (client && cfg.healthPath) await client.get(cfg.healthPath);
  const o = await infinidiskOverview();
  const issues: HealthIssue[] = o.drives
    .filter((d) => d.health !== 'healthy')
    .map((d) => ({
      level: d.health === 'warning' ? 'warning' : 'error',
      message: `${d.name}: ${d.healthDetail ?? d.health}`,
      source: d.mount,
    }));
  if (!o.drives.length) issues.push({ level: 'warning', message: 'No drives reported' });
  return { version: o.version, issues, meta: { drives: o.drives.length } };
}

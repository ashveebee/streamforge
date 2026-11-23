import { db, readPref, writePref } from '../lib/db.js';
import { hostSnapshot } from '../host.js';
import { isConfigured } from '../settings.js';
import { arrDisks } from './arr.js';
import { infinidiskOverview } from './infinidisk.js';
import { arrInstances } from './instances.js';
import { emit } from './notify.js';

/*
 * Storage forecast.
 *
 * Every hour we record used/total bytes for each volume StreamForge can see —
 * Infinidisk drives, host filesystems and the disks Sonarr/Radarr report —
 * and fit a straight line through the last 30 days to estimate when each
 * will be full. The same sample drives the "disk almost full" notification.
 *
 * The same physical volume often shows up from several sources (e.g. the
 * host's /mnt/media and Sonarr's /data). Volumes with the same capacity and
 * near-identical usage are treated as one, preferring Infinidisk, then the
 * host, then the *arr apps.
 */

const SAMPLE_MS = 60 * 60_000;
const KEEP_MS = 400 * 86_400_000;
const WINDOW_MS = 30 * 86_400_000;

interface Volume {
  key: string;
  label: string;
  used: number;
  total: number;
}

let alertPercent = readPref<number>('diskAlertPercent', 90);
const alerted = new Set<string>();

async function collect(): Promise<Volume[]> {
  const out: Volume[] = [];
  if (isConfigured('infinidisk')) {
    const inf = await infinidiskOverview().catch(() => undefined);
    for (const d of inf?.drives ?? []) if (d.total > 0) out.push({ key: `inf:${d.id}`, label: d.name, used: d.used, total: d.total });
  }
  for (const f of hostSnapshot().filesystems ?? []) {
    if (f.size > 0) out.push({ key: `host:${f.mount}`, label: f.mount, used: f.used, total: f.size });
  }
  for (const inst of arrInstances()) {
    const disks = await arrDisks(inst).catch(() => []);
    for (const d of disks) out.push({ key: `arr:${d.path}`, label: d.label || d.path, used: d.total - d.free, total: d.total });
  }
  // Drop duplicates of the same physical volume (first source wins).
  const unique: Volume[] = [];
  for (const v of out) {
    const dup = unique.some(
      (u) => u.key === v.key || (Math.abs(u.total - v.total) <= u.total * 0.001 && Math.abs(u.used - v.used) <= u.total * 0.01),
    );
    if (!dup) unique.push(v);
  }
  // Tiny pseudo-filesystems (boot partitions, tmpfs) aren't interesting.
  return unique.filter((v) => v.total >= 8 * 1024 ** 3);
}

const insert = db.prepare('INSERT OR REPLACE INTO disk_samples (key, label, t, used, total) VALUES (?, ?, ?, ?, ?)');

export async function sampleStorage() {
  const vols = await collect();
  const t = Math.floor(Date.now() / SAMPLE_MS) * SAMPLE_MS;
  for (const v of vols) insert.run(v.key, v.label, t, v.used, v.total);
  db.prepare('DELETE FROM disk_samples WHERE t < ?').run(Date.now() - KEEP_MS);

  for (const v of vols) {
    const usage = (v.used / v.total) * 100;
    if (usage >= alertPercent && !alerted.has(v.key)) {
      alerted.add(v.key);
      emit('disk_low', {
        title: `${v.label} is ${Math.round(usage)}% full`,
        message: `${formatBytes(v.total - v.used)} free of ${formatBytes(v.total)}.`,
        url: '/system',
      });
    } else if (usage < alertPercent - 2) {
      alerted.delete(v.key);
    }
  }
}

function formatBytes(n: number) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

/** Least-squares slope of used bytes over time, in bytes per day. */
export function slopePerDay(points: { t: number; used: number }[]) {
  const n = points.length;
  if (n < 2) return undefined;
  const mt = points.reduce((a, p) => a + p.t, 0) / n;
  const mu = points.reduce((a, p) => a + p.used, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mt) * (p.used - mu);
    den += (p.t - mt) ** 2;
  }
  return den ? (num / den) * 86_400_000 : undefined;
}

export function storageForecast() {
  const now = Date.now();
  const rows = db
    .prepare('SELECT key, label, t, used, total FROM disk_samples WHERE t >= ? ORDER BY t')
    .all(now - WINDOW_MS) as { key: string; label: string; t: number; used: number; total: number }[];
  const byKey = new Map<string, typeof rows>();
  for (const r of rows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);

  const volumes = [];
  for (const [key, pts] of byKey) {
    const last = pts.at(-1)!;
    if (now - last.t > 2 * 86_400_000) continue; // gone
    const span = last.t - pts[0]!.t;
    // Need a day of history before a trend means anything.
    const slope = span >= 86_400_000 && pts.length >= 6 ? slopePerDay(pts) : undefined;
    const free = last.total - last.used;
    const daysLeft = slope && slope > 1024 ** 2 ? free / slope : undefined;
    // One point per day for the sparkline.
    const daily = new Map<number, { t: number; used: number }>();
    for (const p of pts) daily.set(Math.floor(p.t / 86_400_000), { t: p.t, used: p.used });
    volumes.push({
      key,
      label: last.label,
      used: last.used,
      total: last.total,
      usage: last.used / last.total,
      since: new Date(pts[0]!.t).toISOString(),
      growthPerDay: slope,
      daysLeft: daysLeft !== undefined ? Math.round(daysLeft) : undefined,
      fullOn: daysLeft !== undefined && daysLeft < 3650 ? new Date(now + daysLeft * 86_400_000).toISOString() : undefined,
      history: [...daily.values()],
    });
  }
  volumes.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || b.usage - a.usage);
  return { volumes, alertPercent };
}

export function setAlertPercent(p: number) {
  alertPercent = p;
  writePref('diskAlertPercent', p);
  alerted.clear();
  return storageForecast();
}

export function startStorageSampler() {
  // Give the host/infinidisk monitors a moment to take their first readings.
  setTimeout(() => void sampleStorage().catch((err) => console.warn('[storage]', (err as Error).message)), 20_000).unref();
  setInterval(() => void sampleStorage().catch((err) => console.warn('[storage]', (err as Error).message)), SAMPLE_MS).unref();
}

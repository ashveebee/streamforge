import { isIP } from 'node:net';
import { db, readPref, writePref } from '../../lib/db.js';
import { config } from '../../config.js';
import { downloadSnapshot, healthSnapshot } from '../../health.js';
import { hostSnapshot } from '../../host.js';
import { clientTotals } from '../clients/index.js';
import type * as jellyfin from '../jellyfin.js';
import { canWatchInBackground, mainNowPlaying } from '../mainServer.js';
import { observeStreams, prunePlays } from '../playability/index.js';
import { analyse, findIncidents, type Incident, type PlayMethod, type StreamPoint, type Tick } from './analyse.js';

/*
 * Buffering diagnosis: the recorder.
 *
 * Every 15 seconds this writes one sample of everything that can make a
 * stream buffer: each stream's position, method, bitrate and transcode
 * speed; the host's CPU and network; the download clients' speeds; and how
 * Jellyfin answered its last health check. Samples are kept for three days.
 *
 * Stalls are found afterwards by looking for streams whose position moved
 * slower than real time while not paused (see analyse.ts).
 */

export const SAMPLE_MS = 15_000;
const KEEP_MS = 3 * 24 * 3600_000;

interface Prefs {
  /** Internet upload speed in Mbps; unset means "estimate from what we've seen". */
  uploadMbps?: number;
}
let prefs: Prefs = readPref<Prefs>('diagnosis', {});
export const diagnosisPrefs = () => prefs;
export function updateDiagnosisPrefs(patch: { uploadMbps: number | null }) {
  prefs = { ...prefs, uploadMbps: patch.uploadMbps ?? undefined };
  writePref('diagnosis', prefs);
  cache = undefined;
  return prefs;
}

/* ------------------------------- recording ------------------------------- */

/** True for addresses on the local network (private, loopback, link-local). */
export function isLocalAddress(addr: string | undefined) {
  if (!addr) return true;
  let ip = addr.trim().replace(/^\[|\]$/g, '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return true;
}

const insert = db.prepare('INSERT OR REPLACE INTO diag_ticks (t, data) VALUES (?, ?)');
const prune = db.prepare('DELETE FROM diag_ticks WHERE t < ?');
let lastError: string | undefined;

export async function recordTick() {
  let streams: Awaited<ReturnType<typeof jellyfin.serverNowPlaying>>;
  try {
    streams = await mainNowPlaying();
    lastError = undefined;
  } catch (err) {
    lastError = (err as Error).message;
    streams = [];
  }
  if (streams === undefined) return;
  // The same sample teaches StreamForge what each device can play.
  observeStreams(streams);
  const t = Date.now();
  const points: StreamPoint[] = streams
    .filter((s) => s.item.mediaType !== 'Audio')
    .map((s) => ({
      id: s.sessionId,
      item: s.item.id,
      user: s.user.name,
      title: s.item.seriesName ? `${s.item.seriesName} · ${s.item.title}` : s.item.title,
      device: s.device,
      client: s.client,
      remote: !isLocalAddress(s.remoteAddress),
      method: s.state.playMethod as PlayMethod,
      paused: s.state.isPaused,
      pos: s.state.positionMs,
      runtime: s.item.runtimeMs,
      src: s.item.bitrate,
      out: s.transcode?.bitrate,
      fps: s.transcode?.isVideoDirect ? undefined : s.transcode?.framerate,
      vfps: s.item.frameRate,
      done: s.transcode?.completion,
      hw: s.transcode && !s.transcode.isVideoDirect ? s.transcode.hwAccel || undefined : undefined,
      reasons: s.transcode?.reasons.length ? s.transcode.reasons : undefined,
      res: s.item.resolution,
      codec: s.item.videoCodec,
    }));

  const host = config.hostMetrics ? hostSnapshot().current : undefined;
  const clients = clientTotals();
  const arrDown = clients ? undefined : downloadSnapshot();
  const jf = healthSnapshot().services.find((s) => s.id === 'jellyfin');
  const tick: Tick = {
    t,
    streams: points,
    cpu: host ? Math.round(host.cpu * 10) / 10 : undefined,
    rx: host ? Math.round(host.rx * 8) : undefined,
    tx: host ? Math.round(host.tx * 8) : undefined,
    down: clients ? clients.down * 8 : arrDown?.available ? arrDown.current * 8 : undefined,
    up: clients ? clients.up * 8 : undefined,
    jf: jf && jf.status !== 'unconfigured' ? { ok: jf.status !== 'offline', ms: jf.latencyMs } : undefined,
  };
  insert.run(t, JSON.stringify(tick));
}

export function startDiagnosisRecorder() {
  setInterval(() => void recordTick().catch(() => undefined), SAMPLE_MS).unref();
  setInterval(() => {
    prune.run(Date.now() - KEEP_MS);
    prunePlays();
  }, 3600_000).unref();
  prune.run(Date.now() - KEEP_MS);
}

/* -------------------------------- reading -------------------------------- */

const selectAll = db.prepare('SELECT data FROM diag_ticks WHERE t >= ? ORDER BY t');

let cache: { at: number; ticks: Tick[]; incidents: Incident[] } | undefined;

/** All recorded samples and the incidents in them, re-read at most every 30 seconds. */
function load() {
  if (cache && Date.now() - cache.at < 30_000) return cache;
  const rows = selectAll.all(Date.now() - KEEP_MS) as { data: string }[];
  const ticks: Tick[] = [];
  for (const r of rows) {
    try {
      ticks.push(JSON.parse(r.data) as Tick);
    } catch {
      /* skip a damaged row */
    }
  }
  cache = { at: Date.now(), ticks, incidents: findIncidents(ticks) };
  return cache;
}

export function diagnosisStatus() {
  const { ticks, incidents } = load();
  const hasKey = canWatchInBackground();
  // Streams seen recently, for "check a moment someone reported".
  const sessions = new Map<string, { id: string; user: string; title: string; device?: string; remote: boolean; first: number; last: number }>();
  for (const t of ticks) {
    for (const s of t.streams) {
      const key = `${s.id}:${s.item}`;
      const cur = sessions.get(key);
      if (cur) cur.last = t.t;
      else sessions.set(key, { id: s.id, user: s.user, title: s.title, device: s.device, remote: s.remote, first: t.t, last: t.t });
    }
  }
  return {
    recording: hasKey,
    reason: hasKey ? lastError : 'Add a Jellyfin API key in Settings so StreamForge can watch streams in the background.',
    since: ticks[0]?.t,
    sampleMs: SAMPLE_MS,
    keepDays: KEEP_MS / 86_400_000,
    uploadMbps: prefs.uploadMbps ?? null,
    hostMetrics: config.hostMetrics,
    incidents: incidents.slice(0, 100),
    plays: [...sessions.values()].sort((a, b) => b.last - a.last).slice(0, 200),
  };
}

export class DiagnosisError extends Error {}

/** Explains an incident, or a moment in one stream (or the whole server). */
export function explain(q: { incident?: string; session?: string; at?: number }) {
  const { ticks, incidents } = load();
  const opts = { uploadBps: prefs.uploadMbps ? prefs.uploadMbps * 1e6 : undefined, history: ticks };
  if (q.incident) {
    const inc = incidents.find((i) => i.id === q.incident);
    if (!inc) throw new DiagnosisError('That stall is no longer on record');
    return { incident: inc, ...analyse(ticks, { from: inc.start, to: inc.end, session: inc.session }, opts) };
  }
  const at = q.at;
  if (!at || !Number.isFinite(at)) throw new DiagnosisError('Pick a time to check');
  if (!ticks.length || at < ticks[0]!.t - 60_000 || at > Date.now() + 60_000) {
    throw new DiagnosisError(`StreamForge only has the last ${KEEP_MS / 86_400_000} days on record, starting when it began recording`);
  }
  // A stall in this stream close to the reported time explains it best:
  // people rarely remember the exact minute.
  const near = q.session
    ? incidents.filter((i) => i.session === q.session && i.end >= at - 10 * 60_000 && i.start <= at + 10 * 60_000)
    : [];
  const best = near.sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))[0];
  if (best) return { incident: best, ...analyse(ticks, { from: best.start, to: best.end, session: best.session }, opts) };
  return { incident: undefined, ...analyse(ticks, { from: at - 60_000, to: at + 30_000, session: q.session }, opts) };
}

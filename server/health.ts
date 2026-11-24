import { config } from './config.js';
import * as jellyfin from './services/jellyfin.js';
import { arrProbe, arrQueue } from './services/arr.js';
import { arrInstances, onInstancesChange } from './services/instances.js';
import { prowlarr } from './services/prowlarr.js';
import { seerr, seerrProbe } from './services/seerr.js';
import { infinidiskProbe } from './services/infinidisk.js';
import { bazarr, bazarrProbe } from './services/bazarr.js';
import { lidarr, readarr } from './services/music.js';
import { onQueueSample } from './services/queueWatch.js';
import { stalledMap } from './services/cleanup.js';
import { clientTotals } from './services/clients/index.js';
import { emit } from './services/notify.js';
import { isConfigured, isEnabled, onSettingsChange, publicUrl, SERVICE_IDS, SERVICE_NAMES } from './settings.js';
import type { ServiceClient } from './lib/http.js';
import type { HealthIssue, HealthProbe, ServiceId } from './services/types.js';

export type ServiceStatus = 'healthy' | 'degraded' | 'offline' | 'unconfigured';

interface Sample {
  t: number;
  ms: number | null;
}

export interface ServiceHealth {
  /** Service id, or an extra Sonarr/Radarr instance id such as `radarr-4k`. */
  id: string;
  /** Which kind of service this is (equal to id for the built-in ones). */
  kind: ServiceId;
  /** Set for extra Sonarr/Radarr instances. */
  instance?: string;
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
  meta?: HealthProbe['meta'];
  uptime?: number;
  history: Sample[];
}

const HISTORY = 60;

const arr = (c: ServiceClient | undefined, v: 'v1' | 'v3') => (c ? () => arrProbe(c, v) : undefined);

/** The probe for a service's current settings, or undefined if it isn't configured. */
function probeFor(id: ServiceId): (() => Promise<HealthProbe>) | undefined {
  if (!isConfigured(id)) return undefined;
  switch (id) {
    case 'jellyfin':
      return () => jellyfin.probe();
    case 'sonarr':
    case 'radarr':
      return arr(arrInstances(id).find((i) => i.primary)?.client, 'v3');
    case 'prowlarr':
      return arr(prowlarr(), 'v1');
    case 'seerr':
      return seerr() && (() => seerrProbe());
    case 'infinidisk':
      return () => infinidiskProbe();
    case 'bazarr':
      return bazarr() && (() => bazarrProbe());
    case 'lidarr':
      return arr(lidarr(), 'v1');
    case 'readarr':
      return arr(readarr(), 'v1');
  }
}

/** Extra Sonarr/Radarr instances, probed like any other service. */
function extraProbe(id: string) {
  const inst = arrInstances().find((i) => i.id === id && !i.primary);
  return inst ? () => arrProbe(inst.client, 'v3') : undefined;
}

function freshState(id: ServiceId): ServiceHealth {
  const configured = isConfigured(id);
  return {
    id,
    kind: id,
    name: SERVICE_NAMES[id],
    configured,
    status: configured ? 'offline' : 'unconfigured',
    issues: [],
    history: [],
  };
}

const state = new Map<string, ServiceHealth>(SERVICE_IDS.map((id) => [id, freshState(id)]));

/** Adds/removes extra instances so the monitor matches the current set. */
function syncInstances() {
  const extras = arrInstances().filter((i) => !i.primary);
  const live = new Set(extras.map((i) => i.id));
  for (const [id, s] of state) if (s.instance && !live.has(id)) state.delete(id);
  for (const i of extras) {
    const name = `${SERVICE_NAMES[i.kind]} · ${i.name}`;
    const cur = state.get(i.id);
    if (cur && cur.name === name) continue;
    state.set(i.id, { id: i.id, kind: i.kind, instance: i.id, name, configured: true, status: 'offline', issues: [], history: [] });
    void check(i.id);
  }
}

// New settings mean a different server (or none): start its history afresh.
onSettingsChange((id) => {
  state.set(id, freshState(id));
  void check(id);
});
onInstancesChange(() => {
  // Connection details may have changed: restart history for extra instances.
  for (const [id, s] of state) if (s.instance) state.delete(id);
  syncInstances();
});

/*
 * Outage alerts: a service is reported down after two failed checks in a
 * row (to ride out blips), and back up on the first success after that.
 */
const failures = new Map<string, number>();
const alerted = new Set<string>();

function track(s: ServiceHealth, ok: boolean) {
  const path = `/${s.kind}${s.instance ? `?instance=${encodeURIComponent(s.instance)}` : ''}`;
  if (ok) {
    failures.delete(s.id);
    if (alerted.delete(s.id)) emit('service_up', { title: `${s.name} is back online`, message: `${s.name} is responding again.`, url: path });
    return;
  }
  const n = (failures.get(s.id) ?? 0) + 1;
  failures.set(s.id, n);
  if (n === 2 && !alerted.has(s.id)) {
    alerted.add(s.id);
    emit('service_down', { title: `${s.name} is offline`, message: s.error ?? 'Not responding', url: path });
  }
}

async function check(id: string) {
  const probe = (SERVICE_IDS as string[]).includes(id) ? probeFor(id as ServiceId) : extraProbe(id);
  const s = state.get(id);
  if (!probe || !s) return;
  const started = performance.now();
  const now = new Date().toISOString();
  try {
    const r = await probe();
    const ms = Math.round(performance.now() - started);
    const hasError = r.issues.some((i) => i.level === 'error');
    const slow = ms > config.degradedLatencyMs;
    Object.assign(s, {
      status: hasError || slow ? 'degraded' : 'healthy',
      reason: hasError
        ? r.issues.find((i) => i.level === 'error')!.message
        : slow
          ? `Slow response (${ms} ms)`
          : undefined,
      version: r.version ?? s.version,
      latencyMs: ms,
      lastCheck: now,
      lastSuccess: now,
      error: undefined,
      issues: r.issues,
      meta: r.meta,
    } satisfies Partial<ServiceHealth>);
    s.history.push({ t: Date.now(), ms });
  } catch (err) {
    Object.assign(s, {
      status: 'offline',
      reason: (err as Error).message,
      error: (err as Error).message,
      latencyMs: undefined,
      lastCheck: now,
      issues: [],
    } satisfies Partial<ServiceHealth>);
    s.history.push({ t: Date.now(), ms: null });
  }
  // Settings changed while this check was in flight: drop the stale result.
  if (state.get(id) !== s) return;
  if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY);
  const ok = s.history.filter((h) => h.ms !== null).length;
  s.uptime = s.history.length ? ok / s.history.length : undefined;
  track(s, s.status !== 'offline');
}

let lastRun = 0;
async function runAll() {
  lastRun = Date.now();
  syncInstances();
  await Promise.allSettled([...state.keys()].map(check));
}

export function healthSnapshot(visible: (kind: ServiceId) => boolean = () => true) {
  // Disabled services are hidden entirely, not reported as "unconfigured".
  // Primary services carry the address to open them in a browser.
  const services = [...state.values()]
    .filter((s) => isEnabled(s.kind) && visible(s.kind))
    .map((s) => (s.instance || s.status === 'unconfigured' ? s : { ...s, publicUrl: publicUrl(s.kind) }));
  return {
    services,
    checkedAt: lastRun ? new Date(lastRun).toISOString() : undefined,
    intervalMs: config.healthIntervalMs,
    summary: {
      healthy: services.filter((s) => s.status === 'healthy').length,
      degraded: services.filter((s) => s.status === 'degraded').length,
      offline: services.filter((s) => s.status === 'offline').length,
      unconfigured: services.filter((s) => s.status === 'unconfigured').length,
    },
  };
}

export async function recheck() {
  // Basic protection against hammering services via the refresh button.
  if (Date.now() - lastRun > 3_000) await runAll();
  return healthSnapshot();
}

/* ------------------------------------------------------------------ */
/* Download throughput                                                 */
/* ------------------------------------------------------------------ */
/*
 * Sonarr/Radarr expose remaining bytes per queue item but not a live speed.
 * We sample the queues on a short interval and derive throughput from how
 * much `sizeleft` shrank between samples.
 */

interface SpeedSample {
  t: number;
  sonarr: number;
  radarr: number;
}
const speedHistory: SpeedSample[] = [];
const lastLeft = new Map<string, number>();
let lastSampleAt = 0;
const itemSpeeds = new Map<string, number>();
const DL_INTERVAL = 5_000;

async function sampleDownloads() {
  const now = Date.now();
  const dt = lastSampleAt ? (now - lastSampleAt) / 1000 : 0;
  const totals = { sonarr: 0, radarr: 0 };
  const seen = new Set<string>();

  await Promise.all(
    arrInstances().map(async (inst) => {
      const name = inst.kind;
      const q = await arrQueue(inst).catch(() => undefined);
      if (!q) return;
      onQueueSample(inst, q.items);
      for (const item of q.items) {
        const key = `${inst.id}:${item.id}`;
        seen.add(key);
        const prev = lastLeft.get(key);
        lastLeft.set(key, item.sizeLeft);
        if (prev !== undefined && dt > 0 && prev > item.sizeLeft) {
          const speed = (prev - item.sizeLeft) / dt;
          itemSpeeds.set(key, speed);
          totals[name] += speed;
        } else if (prev !== undefined) {
          itemSpeeds.set(key, 0);
        }
      }
    }),
  );
  for (const key of lastLeft.keys()) {
    if (!seen.has(key)) {
      lastLeft.delete(key);
      itemSpeeds.delete(key);
    }
  }
  lastSampleAt = now;
  if (dt > 0) {
    speedHistory.push({ t: now, sonarr: Math.round(totals.sonarr), radarr: Math.round(totals.radarr) });
    if (speedHistory.length > 120) speedHistory.shift();
  }
}

export function downloadSnapshot() {
  const last = speedHistory.at(-1);
  return {
    available: arrInstances().length > 0,
    current: last ? last.sonarr + last.radarr : 0,
    peak: speedHistory.reduce((m, s) => Math.max(m, s.sonarr + s.radarr), 0),
    history: speedHistory,
    itemSpeeds: Object.fromEntries(itemSpeeds),
    stalled: stalledMap(),
    /** Real speeds reported by download clients, when any are set up. */
    clients: clientTotals(),
    sampleIntervalMs: DL_INTERVAL,
  };
}

export function startMonitors() {
  void runAll();
  setInterval(runAll, config.healthIntervalMs).unref();
  // Always scheduled: Sonarr/Radarr can be added from Settings at any time.
  void sampleDownloads();
  setInterval(() => void sampleDownloads(), DL_INTERVAL).unref();
}

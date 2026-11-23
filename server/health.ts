import { config } from './config.js';
import * as jellyfin from './services/jellyfin.js';
import { arrProbe, arrQueue, radarr, sonarr } from './services/arr.js';
import { prowlarr } from './services/prowlarr.js';
import { seerr, seerrProbe } from './services/seerr.js';
import { infinidiskProbe } from './services/infinidisk.js';
import { onSonarrQueue } from './services/autoImport.js';
import { isConfigured, isEnabled, onSettingsChange, SERVICE_IDS, SERVICE_NAMES } from './settings.js';
import type { ServiceClient } from './lib/http.js';
import type { HealthIssue, HealthProbe, ServiceId } from './services/types.js';

export type ServiceStatus = 'healthy' | 'degraded' | 'offline' | 'unconfigured';

interface Sample {
  t: number;
  ms: number | null;
}

export interface ServiceHealth {
  id: ServiceId;
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
      return arr(sonarr(), 'v3');
    case 'radarr':
      return arr(radarr(), 'v3');
    case 'prowlarr':
      return arr(prowlarr(), 'v1');
    case 'seerr':
      return seerr() && (() => seerrProbe());
    case 'infinidisk':
      return () => infinidiskProbe();
  }
}

function freshState(id: ServiceId): ServiceHealth {
  const configured = isConfigured(id);
  return {
    id,
    name: SERVICE_NAMES[id],
    configured,
    status: configured ? 'offline' : 'unconfigured',
    issues: [],
    history: [],
  };
}

const state = new Map<ServiceId, ServiceHealth>(SERVICE_IDS.map((id) => [id, freshState(id)]));

// New settings mean a different server (or none): start its history afresh.
onSettingsChange((id) => {
  state.set(id, freshState(id));
  void check(id);
});

async function check(id: ServiceId) {
  const probe = probeFor(id);
  const s = state.get(id)!;
  if (!probe) return;
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
}

let lastRun = 0;
async function runAll() {
  lastRun = Date.now();
  await Promise.allSettled(SERVICE_IDS.map(check));
}

export function healthSnapshot() {
  // Disabled services are hidden entirely, not reported as "unconfigured".
  const services = [...state.values()].filter((s) => isEnabled(s.id));
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

  const sources = [
    ['sonarr', sonarr()],
    ['radarr', radarr()],
  ] as const;
  await Promise.all(
    sources.map(async ([name, client]) => {
      if (!client) return;
      const q = await arrQueue(client, name).catch(() => undefined);
      if (!q) return;
      if (name === 'sonarr') onSonarrQueue(q.items);
      for (const item of q.items) {
        const key = `${name}:${item.id}`;
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
    available: !!(sonarr() || radarr()),
    current: last ? last.sonarr + last.radarr : 0,
    peak: speedHistory.reduce((m, s) => Math.max(m, s.sonarr + s.radarr), 0),
    history: speedHistory,
    itemSpeeds: Object.fromEntries(itemSpeeds),
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

import { readPref, writePref } from '../lib/db.js';
import { queueAction, type QueueAction } from './arr.js';
import { arrInstances, onInstancesChange, type ArrInstance } from './instances.js';
import { emit } from './notify.js';
import { watchQueues } from './queueWatch.js';
import type { QueueItem } from './types.js';

/*
 * Stalled and failed download cleanup.
 *
 * The download sampler already looks at every queue every few seconds; here
 * we remember when each item last made progress. On a timer, items that
 * match a rule are removed from the download client, blocklisted, and
 * (by default) searched for again:
 *
 *   stalled  – downloading, but no bytes received for `stalledHours`
 *   failed   – the download client reports a failure
 *
 * Items that finished downloading (import problems) are left to auto-import.
 * Progress tracking is in memory, so after a restart an item has to stall
 * for the full period again before it is touched.
 */

export type CleanupAction = Extract<QueueAction, 'remove' | 'blocklist' | 'blocklist-search'>;
export const CLEANUP_ACTIONS: CleanupAction[] = ['blocklist-search', 'blocklist', 'remove'];
export const STALL_HOURS = [1, 2, 3, 6, 12, 24, 48] as const;

export interface CleanupSettings {
  enabled: boolean;
  stalledHours: number;
  /** Also act on downloads the client reports as failed. */
  failed: boolean;
  action: CleanupAction;
}

export interface CleanupEntry {
  id: string;
  at: string;
  instance: string;
  instanceName: string;
  kind: 'sonarr' | 'radarr';
  title: string;
  release: string;
  reason: string;
  action: CleanupAction;
  outcome: 'done' | 'failed' | 'preview';
  error?: string;
}

const PREF = 'queueCleanup';
const PREF_LOG = 'queueCleanupLog';
const LOG_SIZE = 50;
const CHECK_EVERY_MS = 5 * 60_000;
/** Never touch more than this many items in one sweep — a safety valve. */
const MAX_PER_RUN = 10;

let settings: CleanupSettings = {
  enabled: false,
  stalledHours: 6,
  failed: true,
  action: 'blocklist-search',
  ...readPref<Partial<CleanupSettings>>(PREF, {}),
};
const log: CleanupEntry[] = readPref<CleanupEntry[]>(PREF_LOG, []).slice(0, LOG_SIZE);

interface Track {
  item: QueueItem;
  inst: ArrInstance;
  sizeLeft: number;
  /** When sizeLeft last went down (or when we first saw the item). */
  progressAt: number;
}
const tracked = new Map<string, Track>();
let lastRun: string | undefined;
let running = false;

// 'queued' means waiting for a slot in the client — that's not stalling.
const ACTIVE = new Set(['downloading', 'warning']);
const FAILED_TEXT = /fail|error|corrupt|unpack|par2|repair|missing articles|not enough|unavailable/i;

/** Whether the item's status means it is (meant to be) downloading. */
function downloading(i: QueueItem) {
  return ACTIVE.has(i.status) && i.sizeLeft > 0 && i.trackedState !== 'importPending' && i.trackedState !== 'importBlocked';
}

function isFailed(i: QueueItem) {
  if (i.status === 'failed' || i.trackedState === 'failed' || i.trackedState === 'failedPending') return true;
  return i.trackedStatus === 'error' && i.trackedState === 'downloading' && FAILED_TEXT.test([i.errorMessage, ...i.warnings].join(' '));
}

function sample(inst: ArrInstance, items: QueueItem[]) {
  const now = Date.now();
  const prefix = `${inst.id}:`;
  const live = new Set<string>();
  for (const item of items) {
    const key = prefix + item.id;
    live.add(key);
    const prev = tracked.get(key);
    // Paused or held items aren't stalled; restart their clock.
    const paused = !downloading(item);
    if (!prev || paused || item.sizeLeft !== prev.sizeLeft) {
      tracked.set(key, { item, inst, sizeLeft: item.sizeLeft, progressAt: now });
    } else {
      prev.item = item;
      prev.inst = inst;
    }
  }
  for (const key of tracked.keys()) if (key.startsWith(prefix) && !live.has(key)) tracked.delete(key);
}

/** Stalled-since timestamps for the UI, keyed like download speeds (`instance:id`). */
export function stalledMap(minMs = 30 * 60_000) {
  const out: Record<string, string> = {};
  const now = Date.now();
  for (const [key, t] of tracked) {
    if (downloading(t.item) && now - t.progressAt >= minMs) out[key] = new Date(t.progressAt).toISOString();
  }
  return out;
}

function candidates() {
  const now = Date.now();
  const limit = settings.stalledHours * 3_600_000;
  const out: { t: Track; reason: string }[] = [];
  for (const t of tracked.values()) {
    if (settings.failed && isFailed(t.item)) {
      out.push({ t, reason: t.item.errorMessage || t.item.warnings[0] || 'Download failed' });
    } else if (downloading(t.item) && now - t.progressAt >= limit) {
      const h = Math.floor((now - t.progressAt) / 3_600_000);
      out.push({ t, reason: `No progress for ${h} hour${h === 1 ? '' : 's'}` });
    }
  }
  return out;
}

export async function runCleanup(opts: { dryRun?: boolean } = {}): Promise<CleanupEntry[]> {
  if (running && !opts.dryRun) return [];
  if (!opts.dryRun) running = true;
  try {
    const results: CleanupEntry[] = [];
    for (const { t, reason } of candidates().slice(0, MAX_PER_RUN)) {
      const entry: CleanupEntry = {
        id: `${Date.now().toString(36)}-${t.inst.id}-${t.item.id}`,
        at: new Date().toISOString(),
        instance: t.inst.id,
        instanceName: t.inst.name,
        kind: t.inst.kind,
        title: [t.item.title, t.item.subtitle].filter(Boolean).join(' · '),
        release: t.item.releaseTitle,
        reason,
        action: settings.action,
        outcome: 'preview',
      };
      if (!opts.dryRun) {
        try {
          await queueAction(t.inst, t.item.id, settings.action);
          entry.outcome = 'done';
          tracked.delete(`${t.inst.id}:${t.item.id}`);
          emit('download_removed', {
            title: `Removed stalled download: ${entry.title}`,
            message: `${reason}. ${ACTION_TEXT[settings.action]}.\n${entry.release}`,
            url: `/${t.inst.kind}`,
          });
        } catch (err) {
          entry.outcome = 'failed';
          entry.error = (err as Error).message;
        }
        log.unshift(entry);
        log.splice(LOG_SIZE);
      }
      results.push(entry);
    }
    if (!opts.dryRun) {
      lastRun = new Date().toISOString();
      if (results.length) writePref(PREF_LOG, log);
    }
    return results;
  } finally {
    if (!opts.dryRun) running = false;
  }
}

const ACTION_TEXT: Record<CleanupAction, string> = {
  'blocklist-search': 'Blocklisted and searching for another release',
  blocklist: 'Blocklisted',
  remove: 'Removed from the download client',
};

export function updateCleanup(patch: Partial<CleanupSettings>) {
  settings = { ...settings, ...patch };
  writePref(PREF, settings);
  return cleanupStatus();
}

export function cleanupStatus() {
  return {
    settings,
    actions: CLEANUP_ACTIONS,
    stallHours: STALL_HOURS,
    available: arrInstances().length > 0,
    lastRun,
    nextRun: settings.enabled ? new Date(nextCheck).toISOString() : undefined,
    watching: tracked.size,
    pending: settings.enabled ? candidates().length : 0,
    log,
  };
}

let nextCheck = Date.now() + CHECK_EVERY_MS;
export function startCleanup() {
  watchQueues(sample);
  onInstancesChange(() => tracked.clear());
  setInterval(() => {
    nextCheck = Date.now() + CHECK_EVERY_MS;
    if (settings.enabled) void runCleanup().catch((err) => console.warn('[cleanup]', (err as Error).message));
  }, CHECK_EVERY_MS).unref();
}

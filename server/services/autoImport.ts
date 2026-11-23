import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { UpstreamError, type ServiceClient } from '../lib/http.js';
import { anyInstance, arrInstances, onInstancesChange, type ArrInstance, type ArrKind } from './instances.js';
import { watchQueues } from './queueWatch.js';
import { emit } from './notify.js';
import { radarrPlanner } from './import/radarr.js';
import { sonarrPlanner } from './import/sonarr.js';
import { fileName, isSample, isStuck, type FilePlan, type ManualImportItem, type QueueRecord } from './import/shared.js';

/*
 * Intelligent import for Sonarr/Radarr downloads that finished but couldn't
 * be imported automatically — "Unknown Series/Movie", "Unable to parse",
 * "matched by ID" and so on.
 *
 * For every stuck download we ask the manual-import endpoint what it sees,
 * then a planner (import/sonarr.ts, import/radarr.ts) fills in whatever
 * couldn't be worked out. Conflicting signals are never guessed at, and where
 * supported the proposed match is re-checked before a ManualImport command
 * is issued.
 *
 * Runs on a schedule, shortly after a download becomes stuck, or on demand
 * (optionally as a dry run that only reports what it would do). Settings and
 * history are per kind and cover every instance of that kind.
 */

export type { FilePlan } from './import/shared.js';
export type Outcome = 'imported' | 'queued' | 'skipped' | 'failed' | 'preview';
export type Trigger = 'schedule' | 'queue' | 'manual';

export interface LogEntry {
  id: string;
  at: string;
  trigger: Trigger;
  instance: string;
  instanceName?: string;
  title: string;
  release: string;
  outcome: Outcome;
  message: string;
  files: FilePlan[];
}

export interface AutoImportSettings {
  enabled: boolean;
  intervalMinutes: number;
}

interface Command {
  id: number;
  status: 'queued' | 'started' | 'completed' | 'failed' | 'aborted' | 'cancelled' | 'orphaned';
  message?: string;
}

const LOG_SIZE = 50;
/** Automatic runs give up on a download after this many attempts… */
const MAX_ATTEMPTS = 3;
/** …and wait this long between attempts on the same download. */
const RETRY_AFTER_MS = 30 * 60_000;
const QUEUE_TRIGGER_DELAY_MS = 15_000;

export const INTERVALS = [5, 15, 30, 60, 180, 360] as const;
const DEFAULTS: AutoImportSettings = { enabled: false, intervalMinutes: 15 };

/* Logs written before Radarr support used Sonarr-specific field names. */
type LegacyFile = { name: string; ok: boolean; reason?: string; series?: string; episodes?: string; seriesMethod?: string; episodeMethod?: string };
function upgradeLog(entries: (Omit<LogEntry, 'files'> & { files: LegacyFile[] })[], kind: ArrKind): LogEntry[] {
  return entries.map((e) => ({
    ...e,
    instance: e.instance ?? kind,
    files: e.files.map((f) =>
      f.series !== undefined || f.seriesMethod !== undefined
        ? { name: f.name, ok: f.ok, reason: f.reason, title: f.series, detail: f.episodes, titleMethod: f.seriesMethod, detailMethod: f.episodeMethod }
        : f,
    ) as FilePlan[],
  }));
}

class Engine {
  settings: AutoImportSettings;
  log: LogEntry[];
  private attempts = new Map<string, { count: number; last: number }>();
  private seenStuck = new Set<string>();
  private running?: Promise<LogEntry[]>;
  lastRun?: string;
  lastError?: string;
  nextRunAt?: number;
  private timer?: NodeJS.Timeout;
  private queueTimer?: NodeJS.Timeout;

  constructor(readonly kind: ArrKind) {
    this.settings = { ...DEFAULTS, ...readPref<Partial<AutoImportSettings>>(`${kind}AutoImport`, {}) };
    this.log = upgradeLog(readPref(`${kind}AutoImportLog`, []), kind).slice(0, LOG_SIZE);
  }

  private record(entry: LogEntry) {
    this.log.unshift(entry);
    this.log.splice(LOG_SIZE);
    writePref(`${this.kind}AutoImportLog`, this.log);
  }

  private planner(inst: ArrInstance) {
    return this.kind === 'sonarr' ? sonarrPlanner(inst) : radarrPlanner(inst);
  }

  private async runInstance(inst: ArrInstance, opts: RunOptions): Promise<LogEntry[]> {
    const { trigger, dryRun = false, queueId } = opts;
    const c = inst.client;
    const planner = this.planner(inst);
    const results: LogEntry[] = [];

    const queue = await c.get<{ records: QueueRecord[] }>('/api/v3/queue', {
      pageSize: 250,
      ...(this.kind === 'sonarr' ? { includeSeries: true } : { includeMovie: true }),
    });
    const target = queueId ? queue.records.find((r) => r.id === queueId)?.downloadId : undefined;
    if (queueId && !target) throw new UpstreamError('That download is no longer in the queue', 404, inst.kind);
    const stuck = queue.records.filter((r) => r.downloadId && (target ? r.downloadId === target : isStuck(r)));

    const groups = new Map<string, QueueRecord[]>();
    for (const r of stuck) groups.set(r.downloadId!, [...(groups.get(r.downloadId!) ?? []), r]);

    for (const [downloadId, group] of groups) {
      const first = group[0]!;
      const key = `${inst.id}:${downloadId}`;
      const tried = this.attempts.get(key);
      if (trigger !== 'manual' && tried && (tried.count >= MAX_ATTEMPTS || Date.now() - tried.last < RETRY_AFTER_MS)) continue;

      const entry: LogEntry = {
        id: `${Date.now().toString(36)}-${inst.id}-${first.id}`,
        at: new Date().toISOString(),
        trigger,
        instance: inst.id,
        instanceName: inst.primary ? undefined : inst.name,
        title: first.series?.title ?? first.movie?.title ?? first.title,
        release: first.title,
        outcome: 'skipped',
        message: '',
        files: [],
      };

      try {
        const items = await c.get<ManualImportItem[]>('/api/v3/manualimport', { downloadId, filterExistingFiles: true });
        if (!items.length) {
          entry.message = 'No importable video files found in the download';
        } else {
          const real = items.filter((i) => !isSample(fileName(i)));
          const requests = [];
          for (const item of items) {
            const { plan, request } = await planner.plan(item, group, real.length === 1);
            entry.files.push(plan);
            if (request) requests.push(request);
          }
          const ok = requests.length;
          const total = items.length;
          const matched = entry.files.find((f) => f.ok);
          if (matched?.title) entry.title = matched.title;
          const files = (n: number) => `${n} file${n === 1 ? '' : 's'}`;

          if (!ok) {
            entry.message = entry.files.find((f) => f.reason)?.reason ?? 'Nothing could be matched';
          } else if (dryRun) {
            entry.outcome = 'preview';
            entry.message = `Would import ${ok} of ${files(total)}`;
          } else {
            const cmd = await c.post<Command>('/api/v3/command', { name: 'ManualImport', files: requests, importMode: 'auto' });
            const done = await waitForCommand(c, cmd.id);
            if (!done) {
              entry.outcome = 'queued';
              entry.message = `Import of ${files(ok)} is running`;
            } else if (done.status === 'completed') {
              entry.outcome = 'imported';
              entry.message = `Imported ${ok} of ${files(total)}`;
            } else {
              entry.outcome = 'failed';
              entry.message = done.message || `The import finished as ${done.status}`;
            }
          }
        }
      } catch (err) {
        entry.outcome = 'failed';
        entry.message = (err as Error).message;
      }

      if (!dryRun) {
        const count = (tried?.count ?? 0) + 1;
        this.attempts.set(key, { count, last: Date.now() });
        const prev = this.log.find((l) => l.release === entry.release && l.instance === entry.instance);
        const repeat = entry.outcome === 'skipped' && prev?.outcome === 'skipped' && prev.message === entry.message;
        if (!repeat) this.record(entry);
        if (entry.outcome === 'imported' || entry.outcome === 'queued') emit('import_done', importEvent(entry));
        else if (trigger !== 'manual' && count >= MAX_ATTEMPTS) emit('import_failed', importEvent(entry, true));
        else if (entry.outcome === 'failed') emit('import_failed', importEvent(entry));
      }
      results.push(entry);
    }

    if (!dryRun) {
      const live = new Set(queue.records.map((r) => `${inst.id}:${r.downloadId}`));
      for (const k of this.attempts.keys()) if (k.startsWith(`${inst.id}:`) && !live.has(k)) this.attempts.delete(k);
      cache.delete(`${inst.id}:queue`);
    }
    return results;
  }

  private async execute(opts: RunOptions): Promise<LogEntry[]> {
    const instances = arrInstances(this.kind).filter((i) => !opts.instance || i.id === opts.instance);
    if (opts.instance && !instances.length) throw new UpstreamError('Unknown instance', 404, this.kind);
    const results: LogEntry[] = [];
    const errors: string[] = [];
    for (const inst of instances) {
      try {
        results.push(...(await this.runInstance(inst, opts)));
      } catch (err) {
        if (opts.queueId) throw err;
        errors.push(`${inst.name}: ${(err as Error).message}`);
      }
    }
    if (errors.length && !results.length) throw new UpstreamError(errors.join('; '), undefined, this.kind);
    return results;
  }

  run(opts: RunOptions): Promise<LogEntry[]> {
    if (this.running && !opts.dryRun) return this.running;
    const p = this.execute(opts)
      .then((r) => {
        this.lastError = undefined;
        return r;
      })
      .catch((err) => {
        this.lastError = (err as Error).message;
        throw err;
      })
      .finally(() => {
        if (!opts.dryRun) {
          this.lastRun = new Date().toISOString();
          this.running = undefined;
        }
      });
    if (!opts.dryRun) this.running = p;
    return p;
  }

  private background(trigger: Trigger) {
    void this.run({ trigger }).catch((err) => console.warn(`[auto-import:${this.kind}]`, (err as Error).message));
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextRunAt = undefined;
    if (!this.settings.enabled || !anyInstance(this.kind)) return;
    const ms = this.settings.intervalMinutes * 60_000;
    this.nextRunAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      void this.run({ trigger: 'schedule' })
        .catch((err) => console.warn(`[auto-import:${this.kind}]`, (err as Error).message))
        .finally(() => this.schedule());
    }, ms);
    this.timer.unref();
  }

  /** A download newly becoming stuck triggers an attempt shortly after. */
  onQueue(inst: ArrInstance, items: { id: number; trackedState?: string; trackedStatus?: string }[]) {
    const prefix = `${inst.id}:`;
    const stuckNow = items
      .filter((i) => isStuck({ trackedDownloadState: i.trackedState, trackedDownloadStatus: i.trackedStatus }))
      .map((i) => prefix + i.id);
    const live = new Set(stuckNow);
    for (const k of this.seenStuck) if (k.startsWith(prefix) && !live.has(k)) this.seenStuck.delete(k);
    const fresh = stuckNow.filter((k) => !this.seenStuck.has(k));
    for (const k of fresh) this.seenStuck.add(k);
    if (!fresh.length || !this.settings.enabled || this.queueTimer) return;
    this.queueTimer = setTimeout(() => {
      this.queueTimer = undefined;
      this.background('queue');
    }, QUEUE_TRIGGER_DELAY_MS);
    this.queueTimer.unref();
  }

  update(patch: Partial<AutoImportSettings>) {
    const wasEnabled = this.settings.enabled;
    this.settings = { ...this.settings, ...patch };
    writePref(`${this.kind}AutoImport`, this.settings);
    this.schedule();
    // Switching it on sweeps straight away instead of waiting a full interval.
    if (this.settings.enabled && !wasEnabled && anyInstance(this.kind)) this.background('schedule');
    return this.status();
  }

  reset() {
    this.attempts.clear();
    this.seenStuck.clear();
    this.schedule();
  }

  status() {
    return {
      settings: this.settings,
      intervals: INTERVALS,
      running: !!this.running,
      lastRun: this.lastRun,
      lastError: this.lastError,
      nextRun: this.nextRunAt ? new Date(this.nextRunAt).toISOString() : undefined,
      stuck: this.seenStuck.size,
      log: this.log,
    };
  }
}

function importEvent(e: LogEntry, gaveUp = false) {
  const where = e.instanceName ? ` (${e.instanceName})` : '';
  return {
    title: gaveUp ? `Auto-import gave up: ${e.title}` : e.outcome === 'failed' ? `Import failed: ${e.title}` : `Imported: ${e.title}`,
    message: `${e.message}${where}\n${e.release}`,
    url: `/${e.instance.split('-')[0]}`,
  };
}

async function waitForCommand(c: ServiceClient, id: number, timeoutMs = 45_000): Promise<Command | undefined> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2_000));
    const cmd = await c.get<Command>(`/api/v3/command/${id}`).catch(() => undefined);
    if (cmd && !['queued', 'started'].includes(cmd.status)) return cmd;
  }
  return undefined;
}

interface RunOptions {
  trigger: Trigger;
  dryRun?: boolean;
  /** Restrict to one instance. */
  instance?: string;
  /** Only this queue item (needs `instance` when there are several). */
  queueId?: number;
}

const engines: Record<ArrKind, Engine> = { sonarr: new Engine('sonarr'), radarr: new Engine('radarr') };

export const autoImport = (kind: ArrKind) => engines[kind];

export function startAutoImport() {
  for (const e of Object.values(engines)) e.schedule();
  watchQueues((inst, items) => engines[inst.kind].onQueue(inst, items));
  onInstancesChange(() => {
    for (const e of Object.values(engines)) e.reset();
  });
}

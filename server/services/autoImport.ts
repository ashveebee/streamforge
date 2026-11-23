import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { UpstreamError, type ServiceClient } from '../lib/http.js';
import { onSettingsChange } from '../settings.js';
import { sonarr } from './arr.js';
import type { QueueItem } from './types.js';

/*
 * Intelligent import for Sonarr downloads that finished but couldn't be
 * imported automatically — typically "Unknown Series", "Unable to parse",
 * "matched to series by ID" or episodes that didn't line up.
 *
 * For every stuck download we ask Sonarr's manual-import endpoint what it
 * sees, then fill in whatever it couldn't work out:
 *
 *   series   ← Sonarr's own match → the series it was grabbed for (grab
 *              history) → Sonarr's release-name parser → a strict fuzzy
 *              title match against the library (incl. alternate titles)
 *   episodes ← Sonarr's own match → the parser → season/episode, absolute
 *              or air-date numbers looked up in the series → the episode it
 *              was grabbed for (single-file downloads only)
 *
 * Conflicting signals (e.g. grabbed for one series, filename says another)
 * are never guessed at. Where Sonarr supports it, the proposed match is sent
 * back for re-evaluation and anything still rejected (sample, not an
 * upgrade, …) is left alone. Only then is a ManualImport command issued.
 *
 * Runs on a schedule, whenever a new stuck item shows up in the queue, or on
 * demand (optionally as a dry run that only reports what it would do).
 */

/* --------------------------------- types -------------------------------- */

interface Quality {
  quality?: { id?: number; name?: string };
  revision?: unknown;
}
interface Language {
  id: number;
  name?: string;
}
interface Rejection {
  reason: string;
  type?: 'permanent' | 'temporary';
}
interface SeriesRef {
  id: number;
  title: string;
}
interface EpisodeRef {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  airDate?: string;
  title?: string;
}

interface QueueRecord {
  id: number;
  title: string;
  status: string;
  downloadId?: string;
  seriesId?: number;
  episodeId?: number;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  statusMessages?: { title: string; messages: string[] }[];
  series?: SeriesRef;
}

interface ManualImportItem {
  id?: number;
  path: string;
  relativePath?: string;
  folderName?: string;
  name?: string;
  size?: number;
  series?: SeriesRef;
  seasonNumber?: number;
  episodes?: EpisodeRef[];
  episodeFileId?: number;
  releaseGroup?: string;
  quality?: Quality;
  languages?: Language[];
  indexerFlags?: number;
  releaseType?: string;
  downloadId?: string;
  rejections?: Rejection[];
}

interface ParseResult {
  series?: SeriesRef;
  episodes?: EpisodeRef[];
  parsedEpisodeInfo?: {
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumbers?: number[];
    absoluteEpisodeNumbers?: number[];
    airDate?: string;
    isDaily?: boolean;
    fullSeason?: boolean;
    quality?: Quality;
    languages?: Language[];
    releaseGroup?: string;
  };
}

interface LibrarySeries {
  id: number;
  title: string;
  year?: number;
  alternateTitles?: { title: string }[];
}

interface Command {
  id: number;
  status: 'queued' | 'started' | 'completed' | 'failed' | 'aborted' | 'cancelled' | 'orphaned';
  message?: string;
}

export type MatchMethod = 'sonarr' | 'grab-history' | 'parser' | 'title-match' | 'numbering';
export type Outcome = 'imported' | 'queued' | 'skipped' | 'failed' | 'preview';
export type Trigger = 'schedule' | 'queue' | 'manual';

export interface FilePlan {
  name: string;
  series?: string;
  episodes?: string;
  seriesMethod?: MatchMethod;
  episodeMethod?: MatchMethod;
  ok: boolean;
  reason?: string;
}

export interface LogEntry {
  id: string;
  at: string;
  trigger: Trigger;
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

/* -------------------------------- state --------------------------------- */

const PREF_SETTINGS = 'sonarrAutoImport';
const PREF_LOG = 'sonarrAutoImportLog';
const LOG_SIZE = 50;
/** Automatic runs give up on a download after this many attempts. */
const MAX_ATTEMPTS = 3;
/** …and wait this long between attempts on the same download. */
const RETRY_AFTER_MS = 30 * 60_000;
const QUEUE_TRIGGER_DELAY_MS = 15_000;

export const INTERVALS = [5, 15, 30, 60, 180, 360] as const;
const DEFAULTS: AutoImportSettings = { enabled: false, intervalMinutes: 15 };

let settings: AutoImportSettings = { ...DEFAULTS, ...readPref<Partial<AutoImportSettings>>(PREF_SETTINGS, {}) };
const log: LogEntry[] = readPref<LogEntry[]>(PREF_LOG, []).slice(0, LOG_SIZE);
const attempts = new Map<string, { count: number; last: number }>();
const seenStuck = new Set<number>();

let running: Promise<LogEntry[]> | undefined;
let lastRun: string | undefined;
let lastError: string | undefined;
let nextRunAt: number | undefined;
let timer: NodeJS.Timeout | undefined;
let queueTimer: NodeJS.Timeout | undefined;

/* ------------------------------- helpers -------------------------------- */

const pad = (n: number) => String(n).padStart(2, '0');
const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|ts|m2ts|wmv|mov|webm|mpg|mpeg|flv|ogm|divx|xvid|vob|iso|img)$/i;

function epLabel(eps: EpisodeRef[]) {
  if (!eps.length) return undefined;
  const sorted = [...eps].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const head = `S${pad(first.seasonNumber)}E${pad(first.episodeNumber)}`;
  return sorted.length === 1 ? head : `${head}–E${pad(last.episodeNumber)}`;
}

/** Normalises a title for comparison: "The Office (US)" → "office us". */
export function normaliseTitle(t: string) {
  return t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

/** Sørensen–Dice similarity on character bigrams (0…1). */
export function similarity(a: string, b: string) {
  const x = a.replace(/ /g, '');
  const y = b.replace(/ /g, '');
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

const stripYear = (t: string) => t.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/ +/g, ' ').trim();

/**
 * Finds the library series for a parsed title. Deliberately strict: an exact
 * normalised match (title or alternate title, with or without year), or a
 * single clear winner above 0.9 similarity. Anything ambiguous → undefined.
 */
export function matchSeriesTitle(parsed: string, library: LibrarySeries[]): LibrarySeries | undefined {
  const want = normaliseTitle(parsed);
  const wantNoYear = stripYear(want);
  if (!wantNoYear) return undefined;
  const scored = library.map((s) => {
    const names = [s.title, ...(s.alternateTitles ?? []).map((a) => a.title)].map(normaliseTitle);
    let best = 0;
    for (const n of names) {
      if (n === want || (s.year && `${n} ${s.year}` === want)) return { s, score: 1.01 };
      if (stripYear(n) === wantNoYear) best = Math.max(best, 1);
      else best = Math.max(best, similarity(stripYear(n), wantNoYear));
    }
    return { s, score: best };
  });
  scored.sort((a, b) => b.score - a.score);
  const [top, next] = scored;
  if (!top || top.score < 0.9) return undefined;
  // Two series that look equally right (e.g. a remake without a year) — don't guess.
  if (next && top.score - next.score < 0.05) return undefined;
  return top.s;
}

/** Rejections that only mean "Sonarr couldn't tell what this is". */
const MATCHING_REJECTION =
  /unknown series|unable to (parse|identify|determine)|invalid season or episode|episode.*(not found|unexpected|wasn'?t (matched|found))|matched to series by id|couldn'?t find|no matching|not (be )?parsed|season .* not (found|in)|did not match|doesn'?t match/i;

const isStuck = (r: { trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }) =>
  r.trackedDownloadState === 'importBlocked' ||
  r.trackedDownloadState === 'importFailed' ||
  (r.trackedDownloadState === 'importPending' && (r.trackedDownloadStatus === 'warning' || r.trackedDownloadStatus === 'error'));

/* ------------------------------- matching ------------------------------- */

class Run {
  private parseMemo = new Map<string, Promise<ParseResult | undefined>>();
  private episodeMemo = new Map<number, Promise<EpisodeRef[]>>();
  private library?: Promise<LibrarySeries[]>;
  private canReprocess = true;

  constructor(private c: ServiceClient) {}

  parse(title: string) {
    let p = this.parseMemo.get(title);
    if (!p) {
      p = this.c.get<ParseResult>('/api/v3/parse', { title }).catch(() => undefined);
      this.parseMemo.set(title, p);
    }
    return p;
  }

  episodes(seriesId: number) {
    let p = this.episodeMemo.get(seriesId);
    if (!p) {
      p = this.c.get<EpisodeRef[]>('/api/v3/episode', { seriesId });
      this.episodeMemo.set(seriesId, p);
    }
    return p;
  }

  series() {
    this.library ??= cache.get('sonarr:series', 60_000, () => this.c.get<LibrarySeries[]>('/api/v3/series'));
    return this.library;
  }

  /** Works out series + episodes for one file. */
  async plan(file: ManualImportItem, group: QueueRecord[], singleFile: boolean) {
    const name = file.relativePath?.split('/').at(-1) ?? file.name ?? file.path.split('/').at(-1) ?? file.path;
    const titles = [file.name, name.replace(VIDEO_EXT, ''), file.folderName, group[0]?.title].filter(
      (t): t is string => !!t,
    );
    const plan: FilePlan = { name, ok: false };

    if (file.episodeFileId) return { plan: { ...plan, reason: 'Already imported' } };
    if (/(^|[^a-z])sample([^a-z]|$)/i.test(name)) return { plan: { ...plan, reason: 'Sample file' } };

    const blocking = (file.rejections ?? []).filter((r) => !MATCHING_REJECTION.test(r.reason));
    if (blocking.length) return { plan: { ...plan, reason: blocking.map((r) => r.reason).join('; ') } };

    // Parse every candidate title once; the first useful answer wins.
    const parsed: ParseResult[] = [];
    for (const t of titles) {
      const p = await this.parse(t);
      if (p) parsed.push(p);
    }

    /* ---- series ---- */
    const grabbedId = group.find((r) => r.seriesId)?.seriesId;
    const parserSeries = parsed.find((p) => p.series)?.series;
    let series: SeriesRef | undefined;
    let seriesMethod: MatchMethod | undefined;

    if (file.series) {
      series = file.series;
      seriesMethod = 'sonarr';
    } else if (grabbedId) {
      const lib = await this.series();
      const s = lib.find((x) => x.id === grabbedId);
      if (s) {
        series = s;
        seriesMethod = 'grab-history';
      }
    }
    if (!series && parserSeries) {
      series = parserSeries;
      seriesMethod = 'parser';
    }
    if (!series) {
      const parsedTitle = parsed.map((p) => p.parsedEpisodeInfo?.seriesTitle).find(Boolean);
      if (parsedTitle) {
        const m = matchSeriesTitle(parsedTitle, await this.series());
        if (m) {
          series = m;
          seriesMethod = 'title-match';
        }
      }
    }
    if (!series) return { plan: { ...plan, reason: 'Could not identify the series' } };

    // Grabbed for one series but the filename clearly says another: don't guess.
    if (seriesMethod !== 'sonarr' && grabbedId && parserSeries && parserSeries.id !== grabbedId) {
      return {
        plan: { ...plan, series: series.title, reason: `Conflicting matches: grabbed for one series, file looks like ${parserSeries.title}` },
      };
    }
    Object.assign(plan, { series: series.title, seriesMethod });

    /* ---- episodes ---- */
    let episodes: EpisodeRef[] = [];
    let episodeMethod: MatchMethod | undefined;

    if (file.episodes?.length && file.series?.id === series.id) {
      episodes = file.episodes;
      episodeMethod = 'sonarr';
    }
    if (!episodes.length) {
      const hit = parsed.find((p) => p.series?.id === series.id && p.episodes?.length);
      if (hit) {
        episodes = hit.episodes!;
        episodeMethod = 'parser';
      }
    }
    if (!episodes.length) {
      const all = await this.episodes(series.id);
      for (const p of parsed) {
        const info = p.parsedEpisodeInfo;
        if (!info || info.fullSeason) continue;
        let found: EpisodeRef[] = [];
        if (info.episodeNumbers?.length && info.seasonNumber !== undefined) {
          found = info.episodeNumbers
            .map((n) => all.find((e) => e.seasonNumber === info.seasonNumber && e.episodeNumber === n))
            .filter((e): e is EpisodeRef => !!e);
          if (found.length !== info.episodeNumbers.length) found = [];
        }
        if (!found.length && info.absoluteEpisodeNumbers?.length) {
          found = info.absoluteEpisodeNumbers
            .map((n) => all.find((e) => e.absoluteEpisodeNumber === n))
            .filter((e): e is EpisodeRef => !!e);
          if (found.length !== info.absoluteEpisodeNumbers.length) found = [];
        }
        if (!found.length && info.airDate) {
          const day = info.airDate.slice(0, 10);
          const onDay = all.filter((e) => e.airDate === day);
          if (onDay.length === 1) found = onDay;
        }
        if (found.length) {
          episodes = found;
          episodeMethod = 'numbering';
          break;
        }
      }
    }
    if (!episodes.length && singleFile && seriesMethod !== 'title-match') {
      const ids = [...new Set(group.filter((r) => r.seriesId === series.id).map((r) => r.episodeId))].filter(
        (id): id is number => !!id,
      );
      if (ids.length) {
        const all = await this.episodes(series.id);
        const found = ids.map((id) => all.find((e) => e.id === id)).filter((e): e is EpisodeRef => !!e);
        if (found.length === ids.length) {
          episodes = found;
          episodeMethod = 'grab-history';
        }
      }
    }
    if (!episodes.length) return { plan: { ...plan, reason: 'Could not work out which episode(s) this is' } };

    Object.assign(plan, { episodes: epLabel(episodes), episodeMethod });

    const info = parsed.find((p) => p.parsedEpisodeInfo)?.parsedEpisodeInfo;
    const quality = file.quality?.quality?.id !== undefined ? file.quality : info?.quality;
    if (!quality?.quality) return { plan: { ...plan, reason: 'Could not determine quality' } };

    const request = {
      id: file.id,
      path: file.path,
      folderName: file.folderName,
      seriesId: series.id,
      seasonNumber: episodes[0]!.seasonNumber,
      episodeIds: episodes.map((e) => e.id),
      quality,
      languages: file.languages?.length ? file.languages : (info?.languages ?? []),
      releaseGroup: file.releaseGroup ?? info?.releaseGroup,
      indexerFlags: file.indexerFlags ?? 0,
      releaseType: file.releaseType ?? (episodes.length > 1 ? 'multiEpisode' : 'singleEpisode'),
      downloadId: file.downloadId ?? group[0]?.downloadId,
    };

    // Let Sonarr re-check the proposed match (Sonarr v4+). Anything it still
    // rejects — not an upgrade, sample, etc. — is left for a human.
    if (this.canReprocess) {
      try {
        const [checked] = await this.c.post<ManualImportItem[]>('/api/v3/manualimport', [request]);
        const still = checked?.rejections ?? [];
        if (still.length) return { plan: { ...plan, reason: still.map((r) => r.reason).join('; ') } };
      } catch (err) {
        // Older Sonarr has no re-check endpoint; rely on the rejection filter above.
        if (err instanceof UpstreamError && err.status && err.status >= 400 && err.status < 500) this.canReprocess = false;
        else throw err;
      }
    }

    return { plan: { ...plan, ok: true }, request };
  }
}

/* --------------------------------- runs --------------------------------- */

async function waitForCommand(c: ServiceClient, id: number, timeoutMs = 45_000): Promise<Command | undefined> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2_000));
    const cmd = await c.get<Command>(`/api/v3/command/${id}`).catch(() => undefined);
    if (cmd && !['queued', 'started'].includes(cmd.status)) return cmd;
  }
  return undefined;
}

function record(entry: LogEntry) {
  log.unshift(entry);
  log.splice(LOG_SIZE);
  writePref(PREF_LOG, log);
}

interface RunOptions {
  trigger: Trigger;
  dryRun?: boolean;
  /** Only this queue item (manual runs). */
  queueId?: number;
}

async function execute({ trigger, dryRun = false, queueId }: RunOptions): Promise<LogEntry[]> {
  const c = sonarr();
  if (!c) return [];
  const run = new Run(c);
  const results: LogEntry[] = [];

  const queue = await c.get<{ records: QueueRecord[] }>('/api/v3/queue', {
    pageSize: 250,
    includeSeries: true,
    includeEpisode: false,
  });
  const target = queueId ? queue.records.find((r) => r.id === queueId)?.downloadId : undefined;
  if (queueId && !target) throw new UpstreamError('That download is no longer in the Sonarr queue', 404, 'sonarr');
  const stuck = queue.records.filter((r) => r.downloadId && (target ? r.downloadId === target : isStuck(r)));

  const groups = new Map<string, QueueRecord[]>();
  for (const r of stuck) groups.set(r.downloadId!, [...(groups.get(r.downloadId!) ?? []), r]);

  for (const [downloadId, group] of groups) {
    const first = group[0]!;
    const tried = attempts.get(downloadId);
    if (trigger !== 'manual' && tried) {
      if (tried.count >= MAX_ATTEMPTS) continue;
      if (Date.now() - tried.last < RETRY_AFTER_MS) continue;
    }

    const entry: LogEntry = {
      id: `${Date.now().toString(36)}-${first.id}`,
      at: new Date().toISOString(),
      trigger,
      title: first.series?.title ?? first.title,
      release: first.title,
      outcome: 'skipped',
      message: '',
      files: [],
    };

    try {
      const items = await c.get<ManualImportItem[]>('/api/v3/manualimport', {
        downloadId,
        filterExistingFiles: true,
      });
      if (!items.length) {
        entry.message = 'No importable video files found in the download';
      } else {
        const requests = [];
        for (const item of items) {
          const { plan, request } = await run.plan(item, group, items.length === 1);
          entry.files.push(plan);
          if (request) requests.push(request);
        }
        const ok = requests.length;
        const total = items.length;
        const matched = entry.files.filter((f) => f.ok);
        if (matched[0]?.series) entry.title = matched[0].series;

        if (!ok) {
          entry.message = entry.files[0]?.reason ?? 'Nothing could be matched';
        } else if (dryRun) {
          entry.outcome = 'preview';
          entry.message = `Would import ${ok} of ${total} file${total === 1 ? '' : 's'}`;
        } else {
          const cmd = await c.post<Command>('/api/v3/command', {
            name: 'ManualImport',
            files: requests,
            importMode: 'auto',
          });
          const done = await waitForCommand(c, cmd.id);
          if (!done) {
            entry.outcome = 'queued';
            entry.message = `Import of ${ok} file${ok === 1 ? '' : 's'} is running in Sonarr`;
          } else if (done.status === 'completed') {
            entry.outcome = 'imported';
            entry.message = `Imported ${ok} of ${total} file${total === 1 ? '' : 's'}`;
          } else {
            entry.outcome = 'failed';
            entry.message = done.message || `Sonarr reported the import as ${done.status}`;
          }
        }
      }
    } catch (err) {
      entry.outcome = 'failed';
      entry.message = (err as Error).message;
    }

    if (!dryRun) {
      attempts.set(downloadId, { count: (tried?.count ?? 0) + 1, last: Date.now() });
      // Avoid flooding the log with the same skip every interval.
      const prev = log.find((l) => l.release === entry.release);
      if (!(entry.outcome === 'skipped' && prev?.outcome === 'skipped' && prev.message === entry.message)) record(entry);
    }
    results.push(entry);
  }

  if (!dryRun) {
    // Forget downloads that have left the queue.
    const live = new Set(queue.records.map((r) => r.downloadId));
    for (const id of attempts.keys()) if (!live.has(id)) attempts.delete(id);
    cache.delete('sonarr:queue');
  }
  return results;
}

/** Runs once (or joins the run in progress). */
export function runAutoImport(opts: RunOptions): Promise<LogEntry[]> {
  if (running && !opts.dryRun) return running;
  const p = execute(opts)
    .then((r) => {
      lastError = undefined;
      return r;
    })
    .catch((err) => {
      lastError = (err as Error).message;
      throw err;
    })
    .finally(() => {
      if (!opts.dryRun) {
        lastRun = new Date().toISOString();
        running = undefined;
      }
    });
  if (!opts.dryRun) running = p;
  return p;
}

/* ------------------------------- schedule ------------------------------- */

function schedule() {
  clearTimeout(timer);
  timer = undefined;
  nextRunAt = undefined;
  if (!settings.enabled || !sonarr()) return;
  const ms = settings.intervalMinutes * 60_000;
  nextRunAt = Date.now() + ms;
  timer = setTimeout(() => {
    void runAutoImport({ trigger: 'schedule' })
      .catch((err) => console.warn('[auto-import]', (err as Error).message))
      .finally(schedule);
  }, ms);
  timer.unref();
}

/**
 * Called with each fresh Sonarr queue sample. When a download newly becomes
 * stuck, an import is attempted shortly after rather than waiting for the
 * next scheduled sweep.
 */
export function onSonarrQueue(items: QueueItem[]) {
  const stuckNow = items.filter((i) => isStuck({ trackedDownloadState: i.trackedState, trackedDownloadStatus: i.trackedStatus }));
  const live = new Set(stuckNow.map((i) => i.id));
  for (const id of seenStuck) if (!live.has(id)) seenStuck.delete(id);
  const fresh = stuckNow.filter((i) => !seenStuck.has(i.id));
  for (const i of fresh) seenStuck.add(i.id);
  if (!fresh.length || !settings.enabled || queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = undefined;
    void runAutoImport({ trigger: 'queue' }).catch((err) => console.warn('[auto-import]', (err as Error).message));
  }, QUEUE_TRIGGER_DELAY_MS);
  queueTimer.unref();
}

export function updateAutoImport(patch: Partial<AutoImportSettings>) {
  const wasEnabled = settings.enabled;
  settings = { ...settings, ...patch };
  writePref(PREF_SETTINGS, settings);
  schedule();
  // Switching it on sweeps straight away instead of waiting a full interval.
  if (settings.enabled && !wasEnabled && sonarr()) {
    void runAutoImport({ trigger: 'schedule' }).catch((err) => console.warn('[auto-import]', (err as Error).message));
  }
  return autoImportStatus();
}

export function autoImportStatus() {
  return {
    settings,
    intervals: INTERVALS,
    running: !!running,
    lastRun,
    lastError,
    nextRun: nextRunAt ? new Date(nextRunAt).toISOString() : undefined,
    stuck: seenStuck.size,
    log,
  };
}

export function startAutoImport() {
  schedule();
  onSettingsChange((id) => {
    if (id !== 'sonarr') return;
    attempts.clear();
    seenStuck.clear();
    schedule();
  });
}

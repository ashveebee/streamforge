import { UpstreamError, type ServiceClient } from '../../lib/http.js';

/* Pieces shared by the Sonarr and Radarr import planners. */

export interface Quality {
  quality?: { id?: number; name?: string };
  revision?: unknown;
}
export interface Language {
  id: number;
  name?: string;
}
export interface Rejection {
  reason: string;
  type?: 'permanent' | 'temporary';
}

/** A queue record with the fields either *arr may include. */
export interface QueueRecord {
  id: number;
  title: string;
  status: string;
  downloadId?: string;
  seriesId?: number;
  episodeId?: number;
  movieId?: number;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  statusMessages?: { title: string; messages: string[] }[];
  series?: { id: number; title: string };
  movie?: { id: number; title: string; year?: number };
}

/** One file as Sonarr/Radarr's manual-import endpoint describes it. */
export interface ManualImportItem {
  id?: number;
  path: string;
  relativePath?: string;
  folderName?: string;
  name?: string;
  size?: number;
  series?: { id: number; title: string };
  seasonNumber?: number;
  episodes?: EpisodeRef[];
  episodeFileId?: number;
  movie?: { id: number; title: string; year?: number };
  movieFileId?: number;
  releaseGroup?: string;
  quality?: Quality;
  languages?: Language[];
  indexerFlags?: number;
  releaseType?: string;
  downloadId?: string;
  rejections?: Rejection[];
}

export interface EpisodeRef {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  airDate?: string;
  title?: string;
}

export type MatchMethod = 'sonarr' | 'radarr' | 'grab-history' | 'parser' | 'title-match' | 'numbering';

export interface FilePlan {
  name: string;
  /** Series or movie title. */
  title?: string;
  /** Episode range (S01E02–E03) or movie year. */
  detail?: string;
  titleMethod?: MatchMethod;
  detailMethod?: MatchMethod;
  ok: boolean;
  reason?: string;
}

export interface PlanResult {
  plan: FilePlan;
  /** The ManualImport file entry to send, when the file can be imported. */
  request?: Record<string, unknown>;
}

export interface Planner {
  plan(file: ManualImportItem, group: QueueRecord[], singleFile: boolean): Promise<PlanResult>;
}

export const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|ts|m2ts|wmv|mov|webm|mpg|mpeg|flv|ogm|divx|xvid|vob|iso|img)$/i;

export const fileName = (f: ManualImportItem) =>
  f.relativePath?.split('/').at(-1) ?? f.name ?? f.path.split('/').at(-1) ?? f.path;

export const isSample = (name: string) => /(^|[^a-z])sample([^a-z]|$)/i.test(name);

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

export const stripYear = (t: string) => t.replace(/\b(19|20)\d{2}\b/g, ' ').replace(/ +/g, ' ').trim();

export interface Titled {
  id: number;
  title: string;
  year?: number;
  originalTitle?: string;
  alternateTitles?: { title: string }[];
}

/**
 * Finds the library entry for a parsed title. Deliberately strict: an exact
 * normalised match (title or alternate title, with or without year), or a
 * single clear winner above 0.9 similarity. With `year`, entries more than a
 * year off are ruled out. Anything ambiguous → undefined.
 */
export function matchTitle<T extends Titled>(parsed: string, library: T[], year?: number): T | undefined {
  const want = normaliseTitle(parsed);
  const wantNoYear = stripYear(want);
  if (!wantNoYear) return undefined;
  const pool = year ? library.filter((s) => !s.year || Math.abs(s.year - year) <= 1) : library;
  const scored = pool.map((s) => {
    const names = [s.title, s.originalTitle, ...(s.alternateTitles ?? []).map((a) => a.title)]
      .filter((n): n is string => !!n)
      .map(normaliseTitle);
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
  // Two entries that look equally right (e.g. a remake without a year) — don't guess.
  if (next && top.score - next.score < 0.05) return undefined;
  return top.s;
}

/** Rejections that only mean "couldn't tell what this is". */
export const MATCHING_REJECTION =
  /unknown (series|movie)|unable to (parse|identify|determine)|invalid season or episode|episode.*(not found|unexpected|wasn'?t (matched|found))|matched to (series|movie) by id|couldn'?t find|no matching|not (be )?parsed|season .* not (found|in)|did not match|doesn'?t match/i;

/** Finished downloading but stuck before import. */
export const isStuck = (r: { trackedDownloadState?: string; trackedDownloadStatus?: string }) =>
  r.trackedDownloadState === 'importBlocked' ||
  r.trackedDownloadState === 'importFailed' ||
  (r.trackedDownloadState === 'importPending' && (r.trackedDownloadStatus === 'warning' || r.trackedDownloadStatus === 'error'));

/**
 * Asks Sonarr/Radarr to re-evaluate a proposed match (newer versions only).
 * Returns remaining rejections, or undefined when the endpoint isn't there.
 */
export async function recheck(c: ServiceClient, request: Record<string, unknown>): Promise<Rejection[] | undefined> {
  try {
    const [checked] = await c.post<ManualImportItem[]>('/api/v3/manualimport', [request]);
    return checked?.rejections ?? [];
  } catch (err) {
    if (err instanceof UpstreamError && err.status && err.status >= 400 && err.status < 500) return undefined;
    throw err;
  }
}

/** Memoises an async lookup per key for the duration of one run. */
export function memo<K, V>(fn: (k: K) => Promise<V>) {
  const m = new Map<K, Promise<V>>();
  return (k: K) => {
    let p = m.get(k);
    if (!p) {
      p = fn(k);
      m.set(k, p);
    }
    return p;
  };
}

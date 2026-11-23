import { cache } from '../../lib/cache.js';
import type { ArrInstance } from '../instances.js';
import {
  fileName,
  isSample,
  matchTitle,
  MATCHING_REJECTION,
  memo,
  recheck,
  VIDEO_EXT,
  type FilePlan,
  type Language,
  type ManualImportItem,
  type MatchMethod,
  type Planner,
  type PlanResult,
  type Quality,
  type QueueRecord,
  type Titled,
} from './shared.js';

/*
 * Radarr:
 *   movie ← Radarr's own match → the movie it was grabbed for (grab
 *           history) → Radarr's release-name parser → a strict title match
 *           against the library, which must also agree on the year (±1)
 *
 * Downloads holding several large video files are skipped unless Radarr
 * itself matched each one: a movie is one file, so several usually means
 * extras or a collection.
 */

interface ParseResult {
  movie?: { id: number; title: string; year?: number };
  parsedMovieInfo?: {
    movieTitles?: string[];
    movieTitle?: string;
    year?: number;
    quality?: Quality;
    languages?: Language[];
    releaseGroup?: string;
  };
}

export function radarrPlanner(inst: ArrInstance): Planner {
  const c = inst.client;
  const parse = memo((title: string) => c.get<ParseResult>('/api/v3/parse', { title }).catch(() => undefined));
  const library = () => cache.get(`${inst.id}:movies`, 60_000, () => c.get<Titled[]>('/api/v3/movie'));
  let canRecheck = true;

  return {
    async plan(file: ManualImportItem, group: QueueRecord[], singleFile: boolean): Promise<PlanResult> {
      const name = fileName(file);
      const plan: FilePlan = { name, ok: false };
      if (file.movieFileId) return { plan: { ...plan, reason: 'Already imported' } };
      if (isSample(name)) return { plan: { ...plan, reason: 'Sample file' } };
      const blocking = (file.rejections ?? []).filter((r) => !MATCHING_REJECTION.test(r.reason));
      if (blocking.length) return { plan: { ...plan, reason: blocking.map((r) => r.reason).join('; ') } };

      const titles = [file.name, name.replace(VIDEO_EXT, ''), file.folderName, group[0]?.title].filter((t): t is string => !!t);
      const parsed: ParseResult[] = [];
      for (const t of titles) {
        const p = await parse(t);
        if (p) parsed.push(p);
      }

      const grabbedId = group.find((r) => r.movieId)?.movieId;
      const parserMovie = parsed.find((p) => p.movie)?.movie;
      let movie: { id: number; title: string; year?: number } | undefined;
      let titleMethod: MatchMethod | undefined;

      if (file.movie) {
        movie = file.movie;
        titleMethod = 'radarr';
      } else if (!singleFile) {
        return { plan: { ...plan, reason: 'Several video files in one download — not guessing which is the movie' } };
      } else if (grabbedId) {
        const m = (await library()).find((x) => x.id === grabbedId);
        if (m) {
          movie = m;
          titleMethod = 'grab-history';
        }
      }
      if (!movie && parserMovie) {
        movie = parserMovie;
        titleMethod = 'parser';
      }
      if (!movie) {
        for (const p of parsed) {
          const info = p.parsedMovieInfo;
          const t = info?.movieTitles?.[0] ?? info?.movieTitle;
          const m = t ? matchTitle(t, await library(), info?.year || undefined) : undefined;
          if (m) {
            movie = m;
            titleMethod = 'title-match';
            break;
          }
        }
      }
      if (!movie) return { plan: { ...plan, reason: 'Could not identify the movie' } };

      if (titleMethod !== 'radarr' && grabbedId && parserMovie && parserMovie.id !== grabbedId) {
        return {
          plan: { ...plan, title: movie.title, reason: `Conflicting matches: grabbed for one movie, file looks like ${parserMovie.title}` },
        };
      }
      Object.assign(plan, { title: movie.title, detail: movie.year ? String(movie.year) : undefined, titleMethod });

      const info = parsed.find((p) => p.parsedMovieInfo)?.parsedMovieInfo;
      const quality = file.quality?.quality?.id !== undefined ? file.quality : info?.quality;
      if (!quality?.quality) return { plan: { ...plan, reason: 'Could not determine quality' } };

      const request = {
        id: file.id,
        path: file.path,
        folderName: file.folderName,
        movieId: movie.id,
        quality,
        languages: file.languages?.length ? file.languages : (info?.languages ?? []),
        releaseGroup: file.releaseGroup ?? info?.releaseGroup,
        indexerFlags: file.indexerFlags ?? 0,
        downloadId: file.downloadId ?? group[0]?.downloadId,
      };

      if (canRecheck) {
        const still = await recheck(c, request);
        if (still === undefined) canRecheck = false;
        else if (still.length) return { plan: { ...plan, reason: still.map((r) => r.reason).join('; ') } };
      }
      return { plan: { ...plan, ok: true }, request };
    },
  };
}

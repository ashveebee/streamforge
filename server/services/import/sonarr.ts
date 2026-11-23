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
  type EpisodeRef,
  type FilePlan,
  type ManualImportItem,
  type MatchMethod,
  type Planner,
  type PlanResult,
  type Quality,
  type Language,
  type QueueRecord,
  type Titled,
} from './shared.js';

/*
 * Sonarr:
 *   series   ← Sonarr's own match → the series it was grabbed for (grab
 *              history) → Sonarr's release-name parser → a strict fuzzy
 *              title match against the library (incl. alternate titles)
 *   episodes ← Sonarr's own match → the parser → season/episode, absolute
 *              or air-date numbers looked up in the series → the episode it
 *              was grabbed for (single-file downloads only)
 */

interface ParseResult {
  series?: { id: number; title: string };
  episodes?: EpisodeRef[];
  parsedEpisodeInfo?: {
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumbers?: number[];
    absoluteEpisodeNumbers?: number[];
    airDate?: string;
    fullSeason?: boolean;
    quality?: Quality;
    languages?: Language[];
    releaseGroup?: string;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function epLabel(eps: EpisodeRef[]) {
  if (!eps.length) return undefined;
  const sorted = [...eps].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const head = `S${pad(first.seasonNumber)}E${pad(first.episodeNumber)}`;
  return sorted.length === 1 ? head : `${head}–E${pad(last.episodeNumber)}`;
}

export function sonarrPlanner(inst: ArrInstance): Planner {
  const c = inst.client;
  const parse = memo((title: string) => c.get<ParseResult>('/api/v3/parse', { title }).catch(() => undefined));
  const episodesOf = memo((seriesId: number) => c.get<EpisodeRef[]>('/api/v3/episode', { seriesId }));
  const library = () => cache.get(`${inst.id}:series`, 60_000, () => c.get<Titled[]>('/api/v3/series'));
  let canRecheck = true;

  return {
    async plan(file: ManualImportItem, group: QueueRecord[], singleFile: boolean): Promise<PlanResult> {
      const name = fileName(file);
      const plan: FilePlan = { name, ok: false };
      if (file.episodeFileId) return { plan: { ...plan, reason: 'Already imported' } };
      if (isSample(name)) return { plan: { ...plan, reason: 'Sample file' } };
      const blocking = (file.rejections ?? []).filter((r) => !MATCHING_REJECTION.test(r.reason));
      if (blocking.length) return { plan: { ...plan, reason: blocking.map((r) => r.reason).join('; ') } };

      const titles = [file.name, name.replace(VIDEO_EXT, ''), file.folderName, group[0]?.title].filter((t): t is string => !!t);
      const parsed: ParseResult[] = [];
      for (const t of titles) {
        const p = await parse(t);
        if (p) parsed.push(p);
      }

      /* ---- series ---- */
      const grabbedId = group.find((r) => r.seriesId)?.seriesId;
      const parserSeries = parsed.find((p) => p.series)?.series;
      let series: { id: number; title: string } | undefined;
      let titleMethod: MatchMethod | undefined;

      if (file.series) {
        series = file.series;
        titleMethod = 'sonarr';
      } else if (grabbedId) {
        const s = (await library()).find((x) => x.id === grabbedId);
        if (s) {
          series = s;
          titleMethod = 'grab-history';
        }
      }
      if (!series && parserSeries) {
        series = parserSeries;
        titleMethod = 'parser';
      }
      if (!series) {
        const parsedTitle = parsed.map((p) => p.parsedEpisodeInfo?.seriesTitle).find(Boolean);
        const m = parsedTitle ? matchTitle(parsedTitle, await library()) : undefined;
        if (m) {
          series = m;
          titleMethod = 'title-match';
        }
      }
      if (!series) return { plan: { ...plan, reason: 'Could not identify the series' } };

      // Grabbed for one series but the filename clearly says another: don't guess.
      if (titleMethod !== 'sonarr' && grabbedId && parserSeries && parserSeries.id !== grabbedId) {
        return {
          plan: { ...plan, title: series.title, reason: `Conflicting matches: grabbed for one series, file looks like ${parserSeries.title}` },
        };
      }
      Object.assign(plan, { title: series.title, titleMethod });

      /* ---- episodes ---- */
      let episodes: EpisodeRef[] = [];
      let detailMethod: MatchMethod | undefined;
      if (file.episodes?.length && file.series?.id === series.id) {
        episodes = file.episodes;
        detailMethod = 'sonarr';
      }
      if (!episodes.length) {
        const hit = parsed.find((p) => p.series?.id === series.id && p.episodes?.length);
        if (hit) {
          episodes = hit.episodes!;
          detailMethod = 'parser';
        }
      }
      if (!episodes.length) {
        const all = await episodesOf(series.id);
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
            const onDay = all.filter((e) => e.airDate === info.airDate!.slice(0, 10));
            if (onDay.length === 1) found = onDay;
          }
          if (found.length) {
            episodes = found;
            detailMethod = 'numbering';
            break;
          }
        }
      }
      if (!episodes.length && singleFile && titleMethod !== 'title-match') {
        const ids = [...new Set(group.filter((r) => r.seriesId === series.id).map((r) => r.episodeId))].filter(
          (id): id is number => !!id,
        );
        if (ids.length) {
          const all = await episodesOf(series.id);
          const found = ids.map((id) => all.find((e) => e.id === id)).filter((e): e is EpisodeRef => !!e);
          if (found.length === ids.length) {
            episodes = found;
            detailMethod = 'grab-history';
          }
        }
      }
      if (!episodes.length) return { plan: { ...plan, reason: 'Could not work out which episode(s) this is' } };
      Object.assign(plan, { detail: epLabel(episodes), detailMethod });

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

      // Let Sonarr re-check the proposed match (v4+). Anything it still
      // rejects — not an upgrade, sample, etc. — is left for a human.
      if (canRecheck) {
        const still = await recheck(c, request);
        if (still === undefined) canRecheck = false;
        else if (still.length) return { plan: { ...plan, reason: still.map((r) => r.reason).join('; ') } };
      }
      return { plan: { ...plan, ok: true }, request };
    },
  };
}

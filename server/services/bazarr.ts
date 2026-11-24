import { derived } from '../settings.js';
import { cache } from '../lib/cache.js';
import { createClient, type ServiceClient } from '../lib/http.js';
import type { HealthIssue, HealthProbe } from './types.js';

/* Bazarr: missing subtitles for Sonarr episodes and Radarr movies. */

export const bazarrClient = (url: string, apiKey: string) => createClient('bazarr', url, { 'X-API-KEY': apiKey });
export const bazarr = derived('bazarr', (s) => (s.url && s.apiKey ? bazarrClient(s.url, s.apiKey) : undefined));

function need(): ServiceClient {
  const c = bazarr();
  if (!c) throw new Error('Bazarr is not configured');
  return c;
}

interface Status {
  data: { bazarr_version?: string; sonarr_version?: string; radarr_version?: string; operating_system?: string; start_time?: number };
}
interface Health {
  data: { object: string; issue: string }[];
}

export async function bazarrProbe(client: ServiceClient = need()): Promise<HealthProbe> {
  const [status, health] = await Promise.all([client.get<Status>('/api/system/status'), client.get<Health>('/api/system/health').catch(() => ({ data: [] }))]);
  const issues: HealthIssue[] = (health.data ?? []).map((h) => ({ level: 'warning', message: h.issue, source: h.object }));
  return {
    version: status.data?.bazarr_version,
    issues,
    meta: { sonarr: status.data?.sonarr_version, radarr: status.data?.radarr_version, os: status.data?.operating_system },
  };
}

interface Lang {
  name: string;
  code2?: string;
  hi?: boolean;
  forced?: boolean;
}
interface WantedEpisode {
  seriesTitle: string;
  episode_number?: string;
  episodeTitle?: string;
  missing_subtitles: Lang[];
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
}
interface WantedMovie {
  title: string;
  missing_subtitles: Lang[];
  radarrId: number;
}
interface HistoryRow {
  seriesTitle?: string;
  title?: string;
  episode_number?: string;
  episodeTitle?: string;
  language?: Lang;
  provider?: string;
  timestamp?: string;
  parsed_timestamp?: string;
  description?: string;
  action?: number;
}

const langs = (l: Lang[]) => l.map((x) => `${x.name}${x.forced ? ' (forced)' : x.hi ? ' (HI)' : ''}`);

export async function bazarrOverview() {
  const c = need();
  return cache.get('bazarr:overview', 20_000, async () => {
    const [badges, eps, movies, epHist, movieHist] = await Promise.all([
      c.get<{ episodes?: number; movies?: number; providers?: number; status?: number }>('/api/badges').catch(() => ({}) as Record<string, number>),
      c.get<{ data: WantedEpisode[]; total: number }>('/api/episodes/wanted', { start: 0, length: 50 }).catch(() => ({ data: [], total: 0 })),
      c.get<{ data: WantedMovie[]; total: number }>('/api/movies/wanted', { start: 0, length: 50 }).catch(() => ({ data: [], total: 0 })),
      c.get<{ data: HistoryRow[] }>('/api/episodes/history', { start: 0, length: 15 }).catch(() => ({ data: [] })),
      c.get<{ data: HistoryRow[] }>('/api/movies/history', { start: 0, length: 15 }).catch(() => ({ data: [] })),
    ]);
    const history = [
      ...epHist.data.map((h) => ({ kind: 'episode' as const, title: h.seriesTitle ?? '', subtitle: [h.episode_number, h.episodeTitle].filter(Boolean).join(' · '), h })),
      ...movieHist.data.map((h) => ({ kind: 'movie' as const, title: h.title ?? '', subtitle: '', h })),
    ]
      .map(({ kind, title, subtitle, h }) => ({
        kind,
        title,
        subtitle,
        language: h.language?.name,
        provider: h.provider,
        description: h.description,
        at: h.parsed_timestamp ?? h.timestamp,
      }))
      .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
      .slice(0, 20);
    return {
      counts: { episodes: badges.episodes ?? eps.total, movies: badges.movies ?? movies.total, providerIssues: badges.providers ?? 0, healthIssues: badges.status ?? 0 },
      episodes: {
        total: eps.total,
        items: eps.data.map((e) => ({ seriesId: e.sonarrSeriesId, episodeId: e.sonarrEpisodeId, title: e.seriesTitle, subtitle: [e.episode_number, e.episodeTitle].filter(Boolean).join(' · '), missing: langs(e.missing_subtitles) })),
      },
      movies: { total: movies.total, items: movies.data.map((m) => ({ movieId: m.radarrId, title: m.title, missing: langs(m.missing_subtitles) })) },
      history,
    };
  });
}

/** Searches for missing subtitles of one series/movie, or everything when no id is given. */
export async function bazarrSearch(target: { seriesId?: number; movieId?: number; all?: 'episodes' | 'movies' }) {
  const c = need();
  if (target.seriesId) await c.patch('/api/series', undefined, { seriesid: target.seriesId, action: 'search-missing' });
  else if (target.movieId) await c.patch('/api/movies', undefined, { radarrid: target.movieId, action: 'search-missing' });
  else if (target.all === 'episodes') await c.post('/api/system/tasks', undefined, { taskid: 'wanted_search_missing_subtitles_series' });
  else if (target.all === 'movies') await c.post('/api/system/tasks', undefined, { taskid: 'wanted_search_missing_subtitles_movies' });
  cache.delete('bazarr:');
  return { ok: true };
}

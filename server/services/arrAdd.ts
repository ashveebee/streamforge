import { cache } from '../lib/cache.js';
import { readPref, writePref } from '../lib/db.js';
import { HttpError } from '../lib/handle.js';
import { arrInstance, arrInstances, type ArrInstance } from './instances.js';

/*
 * Adding titles to Sonarr or Radarr, one or many at a time, with the choices
 * Sonarr/Radarr ask for: quality profile, root folder, minimum availability
 * (movies) or which episodes to monitor (series), whether to search now, and
 * an optional "streamforge" tag. Choices are remembered per instance.
 *
 * Titles already in any instance of that kind are skipped rather than added
 * twice. Searches are handed to Sonarr/Radarr as commands, which they run one
 * after another, so a big batch doesn't flood the indexers.
 */

export type ArrKind = 'sonarr' | 'radarr';
export type SeriesMonitor = 'all' | 'future' | 'missing' | 'existing' | 'firstSeason' | 'lastSeason' | 'pilot' | 'none';

export interface AddChoices {
  qualityProfileId: number;
  rootFolderPath: string;
  /** Radarr only. */
  minimumAvailability?: 'announced' | 'inCinemas' | 'released';
  /** Sonarr only: which episodes to monitor. */
  seriesMonitor?: SeriesMonitor;
  monitored: boolean;
  search: boolean;
  /** Adds the "streamforge" tag so these are easy to find later. */
  tag: boolean;
}

export interface AddItem {
  tmdbId?: number;
  tvdbId?: number;
  title?: string;
  year?: number;
}

const PREF = 'arrAddDefaults';
const remembered = () => readPref<Record<string, Partial<AddChoices>>>(PREF, {});
const MAX_ITEMS = 200;
const TAG = 'streamforge';

function need(kind: ArrKind, instanceId?: string): ArrInstance {
  const inst = arrInstance(kind, instanceId);
  if (!inst) throw new HttpError(404, `${kind === 'radarr' ? 'Radarr' : 'Sonarr'} is not configured`, 'not_configured');
  return inst;
}

/** What the add dialog offers for an instance, with the last choices made there. */
export async function addOptions(kind: ArrKind, instanceId?: string) {
  const inst = need(kind, instanceId);
  const c = inst.client;
  const [profiles, roots] = await Promise.all([
    cache.get(`${inst.id}:profiles`, 5 * 60_000, () => c.get<{ id: number; name: string }[]>('/api/v3/qualityprofile')),
    cache.get(`${inst.id}:roots`, 60_000, () => c.get<{ path: string; accessible?: boolean; freeSpace?: number }[]>('/api/v3/rootfolder')),
  ]);
  const saved = remembered()[inst.id] ?? {};
  const profile = profiles.find((p) => p.id === saved.qualityProfileId) ?? profiles[0];
  const root = roots.find((r) => r.path === saved.rootFolderPath) ?? roots.find((r) => r.accessible !== false) ?? roots[0];
  return {
    kind,
    instance: inst.id,
    instances: arrInstances(kind).map((i) => ({ id: i.id, name: i.name, primary: i.primary })),
    profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
    roots: roots.map((r) => ({ path: r.path, freeSpace: r.freeSpace, accessible: r.accessible !== false })),
    defaults: {
      qualityProfileId: profile?.id,
      rootFolderPath: root?.path,
      minimumAvailability: kind === 'radarr' ? (saved.minimumAvailability ?? 'released') : undefined,
      seriesMonitor: kind === 'sonarr' ? (saved.seriesMonitor ?? 'all') : undefined,
      monitored: saved.monitored ?? true,
      search: saved.search ?? true,
      tag: saved.tag ?? false,
    },
  };
}

interface Existing {
  id: number;
  title: string;
  tmdbId?: number;
  tvdbId?: number;
  hasFile?: boolean;
}

/** Everything already in each instance of a kind, keyed by TMDB/TVDB id. */
async function existing(kind: ArrKind) {
  const out = new Map<string, { instance: string; title: string }>();
  await Promise.all(
    arrInstances(kind).map(async (inst) => {
      const list = await cache
        .get(`${inst.id}:${kind === 'radarr' ? 'movies' : 'series'}`, 60_000, () => inst.client.get<Existing[]>(kind === 'radarr' ? '/api/v3/movie' : '/api/v3/series'))
        .catch(() => [] as Existing[]);
      for (const x of list) {
        if (x.tmdbId) out.set(`tmdb:${x.tmdbId}`, { instance: inst.name, title: x.title });
        if (x.tvdbId) out.set(`tvdb:${x.tvdbId}`, { instance: inst.name, title: x.title });
      }
    }),
  );
  return out;
}

const keyOf = (kind: ArrKind, i: AddItem) => (kind === 'sonarr' && i.tvdbId ? `tvdb:${i.tvdbId}` : i.tmdbId ? `tmdb:${i.tmdbId}` : i.tvdbId ? `tvdb:${i.tvdbId}` : undefined);

/** Which titles would be added and which are already in an instance. */
export async function checkItems(kind: ArrKind, items: AddItem[]) {
  const have = await existing(kind);
  return items.slice(0, MAX_ITEMS).map((i) => {
    const key = keyOf(kind, i);
    const found = key ? (have.get(key) ?? (i.tmdbId ? have.get(`tmdb:${i.tmdbId}`) : undefined)) : undefined;
    return { key: key ?? `title:${i.title}`, title: i.title ?? found?.title ?? 'Unknown title', year: i.year, status: !key ? ('invalid' as const) : found ? ('exists' as const) : ('new' as const), instance: found?.instance };
  });
}

async function tagId(inst: ArrInstance) {
  const tags = await inst.client.get<{ id: number; label: string }[]>('/api/v3/tag');
  const found = tags.find((t) => t.label.toLowerCase() === TAG);
  if (found) return found.id;
  return (await inst.client.post<{ id: number }>('/api/v3/tag', { label: TAG })).id;
}

export interface AddResult {
  key: string;
  title: string;
  status: 'added' | 'skipped' | 'failed';
  message?: string;
}

/**
 * Adds titles to one instance. Each title is looked up and added on its own,
 * so one failure doesn't stop the rest; searches are started at the end.
 */
export async function addItems(kind: ArrKind, instanceId: string | undefined, items: AddItem[], choices: AddChoices, remember = true) {
  const inst = need(kind, instanceId);
  if (items.length > MAX_ITEMS) throw new HttpError(400, `Add at most ${MAX_ITEMS} titles at a time.`);
  const c = inst.client;
  const have = await existing(kind);
  const tags = choices.tag ? [await tagId(inst)] : [];
  if (remember) writePref(PREF, { ...remembered(), [inst.id]: choices });

  const results: AddResult[] = [];
  const added: number[] = [];
  for (const item of items) {
    const key = keyOf(kind, item);
    const label = item.title ?? key ?? 'Unknown title';
    if (!key) {
      results.push({ key: `title:${label}`, title: label, status: 'failed', message: 'No TMDB or TVDB id' });
      continue;
    }
    const dupe = have.get(key) ?? (item.tmdbId ? have.get(`tmdb:${item.tmdbId}`) : undefined);
    if (dupe) {
      results.push({ key, title: dupe.title, status: 'skipped', message: `Already in ${dupe.instance}` });
      continue;
    }
    try {
      if (kind === 'radarr') {
        if (!item.tmdbId) throw new Error('Missing TMDB id');
        const movie = await c.get<Record<string, unknown> & { id?: number; title: string }>('/api/v3/movie/lookup/tmdb', { tmdbId: item.tmdbId });
        const res = await c.post<{ id: number; title: string }>('/api/v3/movie', {
          ...movie,
          qualityProfileId: choices.qualityProfileId,
          rootFolderPath: choices.rootFolderPath,
          monitored: choices.monitored,
          minimumAvailability: choices.minimumAvailability ?? 'released',
          tags,
          addOptions: { searchForMovie: false },
        });
        added.push(res.id);
        results.push({ key, title: res.title, status: 'added' });
      } else {
        const term = item.tvdbId ? `tvdb:${item.tvdbId}` : `tmdb:${item.tmdbId}`;
        const found = await c.get<(Record<string, unknown> & { id?: number; title: string; tmdbId?: number; tvdbId?: number })[]>('/api/v3/series/lookup', { term });
        const series = found.find((s) => (item.tvdbId ? s.tvdbId === item.tvdbId : s.tmdbId === item.tmdbId)) ?? found[0];
        if (!series) throw new Error('Sonarr couldn’t find it');
        const res = await c.post<{ id: number; title: string }>('/api/v3/series', {
          ...series,
          qualityProfileId: choices.qualityProfileId,
          rootFolderPath: choices.rootFolderPath,
          monitored: choices.monitored,
          seasonFolder: true,
          tags,
          addOptions: { monitor: choices.seriesMonitor ?? 'all', searchForMissingEpisodes: false },
        });
        added.push(res.id);
        results.push({ key, title: res.title, status: 'added' });
      }
      // Count it as present for any duplicate later in the same batch.
      have.set(key, { instance: inst.name, title: results[results.length - 1]!.title });
    } catch (err) {
      const msg = (err as Error).message;
      const notFound = /\b404\b|not found/i.test(msg);
      results.push({ key, title: label, status: 'failed', message: notFound ? `${inst.name} couldn’t find it` : msg.replace(/^HTTP \d+ /, '').slice(0, 200) });
    }
  }

  // One search command per batch: Sonarr/Radarr work through it title by title.
  let searching = false;
  if (choices.search && choices.monitored && added.length) {
    try {
      if (kind === 'radarr') await c.post('/api/v3/command', { name: 'MoviesSearch', movieIds: added });
      else for (const id of added) await c.post('/api/v3/command', { name: 'SeriesSearch', seriesId: id });
      searching = true;
    } catch {
      /* the titles are added; searching can be started from Sonarr/Radarr */
    }
  }
  cache.delete(`${inst.id}:`);
  return { instance: inst.name, results, searching };
}

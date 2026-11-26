import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { db, readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { HttpError } from '../lib/handle.js';
import { buildUrl, requestJson } from '../lib/http.js';
import { resolve } from '../settings.js';
import * as jellyfin from './jellyfin.js';
import { allLibraryItems, idKeys, openLink, type LibraryServer } from './mainServer.js';
import { mediaServer, mediaServers } from './mediaServers.js';
import * as plex from './plex.js';

/*
 * Collections made in StreamForge and built by Kometa.
 *
 * StreamForge writes one small collection file per library into a
 * `streamforge` folder inside Kometa's config folder (shared with StreamForge
 * as a mount). Kometa reads it on its next run because the library's
 * `collection_files` lists it. StreamForge never edits any other Kometa file.
 *
 * Built collections are read back from the media server (Plex collections,
 * Jellyfin/Emby BoxSets). Missing titles are worked out by asking TMDb what
 * the source holds, using Kometa's own TMDb key from its config.yml.
 */

/* --------------------------------- settings --------------------------------- */

interface CollectionSettings {
  /** Kometa's config folder, as mounted inside StreamForge (e.g. /kometa). */
  configDir?: string;
  /** When Kometa runs, "HH:MM" (Kometa's KOMETA_TIMES). */
  runTimes: string[];
  /** A TMDb API key, when Kometa's config.yml can't be read for one. */
  tmdbKey?: string;
}

const SPREF = 'kometaCollectionSettings';
let settings: CollectionSettings = { runTimes: ['05:00'], ...readPref<Partial<CollectionSettings>>(SPREF, {}) };

const SUBDIR = 'streamforge';

/** Whether StreamForge can write its files into Kometa's config folder. */
function folderState() {
  if (!settings.configDir) return { ok: false, message: 'Set the folder where Kometa’s config is mounted.' };
  try {
    if (!statSync(settings.configDir).isDirectory()) return { ok: false, message: 'That path isn’t a folder.' };
    accessSync(settings.configDir, constants.W_OK);
  } catch {
    return { ok: false, message: 'StreamForge can’t write to that folder. Mount Kometa’s config folder read-write.' };
  }
  return { ok: true, hasConfig: existsSync(path.join(settings.configDir, 'config.yml')) };
}

/** Kometa's TMDb key: the one entered here, or `tmdb: apikey:` from Kometa's config.yml. */
function tmdbKey() {
  if (settings.tmdbKey) return settings.tmdbKey;
  if (!settings.configDir) return undefined;
  try {
    const text = readFileSync(path.join(settings.configDir, 'config.yml'), 'utf8');
    const block = text.match(/^tmdb:\s*\n((?:[ \t]+.*\n?)+)/m)?.[1];
    const key = block?.match(/^\s+apikey:\s*["']?([A-Za-z0-9]{16,64})["']?\s*$/m)?.[1];
    return key;
  } catch {
    return undefined;
  }
}

export function collectionSettings() {
  return {
    configDir: settings.configDir ?? '',
    runTimes: settings.runTimes,
    tmdbKeySet: !!settings.tmdbKey,
    tmdbKeyFromKometa: !settings.tmdbKey && !!tmdbKey(),
    folder: folderState(),
  };
}

export function updateCollectionSettings(p: { configDir?: string; runTimes?: string[]; tmdbKey?: string }) {
  if (p.configDir !== undefined) settings.configDir = p.configDir.trim() || undefined;
  if (p.runTimes) settings.runTimes = p.runTimes.filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 12);
  if (p.tmdbKey !== undefined) settings.tmdbKey = p.tmdbKey.trim() || undefined;
  writePref(SPREF, settings);
  writeFiles();
  return collectionSettings();
}

/** The next time Kometa is due to run, from the times entered in Settings. */
export function nextRun(now = new Date()) {
  const times = settings.runTimes.map((t) => t.split(':').map(Number) as [number, number]);
  let best: Date | undefined;
  for (const [h, m] of times) {
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    if (!best || d < best) best = d;
  }
  return best?.toISOString();
}

/* -------------------------------- collections -------------------------------- */

export type SourceType = 'tmdb_list' | 'imdb_list' | 'trakt_list' | 'tmdb_trending_weekly' | 'tmdb_popular' | 'tmdb_keyword' | 'manual';

export interface Collection {
  id: string;
  name: string;
  library: { server: string; serverType: 'jellyfin' | 'plex' | 'emby'; serverName: string; id: string; name: string; kind: 'movie' | 'show' };
  source: { type: SourceType; value?: string; ids?: number[]; limit?: number };
  /** "always", or a month-day range Kometa runs it in, e.g. 12/01-12/31. */
  schedule: { from: string; to: string } | 'always';
  order: 'custom' | 'release' | 'alpha';
  /** Send titles the library doesn't have to Radarr/Sonarr. */
  addMissing: boolean;
  /** Plex only. */
  visibleHome: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

const CPREF = 'kometaCollections';
let list: Collection[] = readPref<Collection[]>(CPREF, []);
const save = () => {
  writePref(CPREF, list);
  writeFiles();
  cache.delete('kometa:col:');
};

export const managedCollections = () => list;
export const getCollection = (id: string) => list.find((c) => c.id === id);

/** File name for one library's collections. */
const fileFor = (lib: Collection['library']) =>
  `${`${lib.serverType}-${lib.serverName}-${lib.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'library'}.yml`;

/** A YAML double-quoted string (JSON strings are valid YAML). */
const q = (s: string) => JSON.stringify(s);

function entry(c: Collection) {
  const lines: string[] = [`  ${q(c.name)}:`];
  const s = c.source;
  switch (s.type) {
    case 'manual':
      lines.push(`    ${c.library.kind === 'movie' ? 'tmdb_movie' : 'tmdb_show'}: [${(s.ids ?? []).join(', ')}]`);
      break;
    case 'tmdb_trending_weekly':
    case 'tmdb_popular':
      lines.push(`    ${s.type}: ${s.limit ?? 30}`);
      break;
    default:
      lines.push(`    ${s.type}: ${q(s.value ?? '')}`);
  }
  lines.push(`    collection_order: ${c.order}`, '    sync_mode: sync');
  if (c.addMissing) lines.push(`    ${c.library.kind === 'movie' ? 'radarr_add_missing' : 'sonarr_add_missing'}: true`);
  if (c.visibleHome && c.library.serverType === 'plex') lines.push('    visible_home: true');
  if (c.schedule !== 'always') lines.push(`    schedule: range(${c.schedule.from}-${c.schedule.to})`, '    delete_not_scheduled: true');
  return lines.join('\n');
}

/**
 * Rewrites StreamForge's files: one per library that has collections. Files
 * for libraries with none left are emptied (Kometa ignores an empty list),
 * never deleted, so a config line pointing at one doesn't break a run.
 */
function writeFiles() {
  if (!folderState().ok) return;
  const dir = path.join(settings.configDir!, SUBDIR);
  mkdirSync(dir, { recursive: true });
  const byFile = new Map<string, Collection[]>();
  for (const c of list) byFile.set(fileFor(c.library), [...(byFile.get(fileFor(c.library)) ?? []), c]);
  const known = new Set<string>(readPref<string[]>('kometaFiles', []));
  for (const f of byFile.keys()) known.add(f);
  for (const f of known) {
    const cols = byFile.get(f) ?? [];
    const body = [
      '# Managed by StreamForge. Changes made here are overwritten; edit these collections in StreamForge.',
      cols.length ? 'collections:' : 'collections: {}',
      ...cols.map(entry),
      '',
    ].join('\n');
    const tmp = path.join(dir, `.${f}.tmp`);
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, path.join(dir, f));
  }
  writePref('kometaFiles', [...known]);
}

/**
 * Makes sure every library has its (possibly empty) file, so the line Settings
 * shows can be added to Kometa's config.yml before any collection exists.
 */
function ensureLibraryFiles(libs: Collection['library'][]) {
  if (!folderState().ok) return;
  const known = new Set<string>(readPref<string[]>('kometaFiles', []));
  const missing = libs.map(fileFor).filter((f) => !known.has(f) || !existsSync(path.join(settings.configDir!, SUBDIR, f)));
  if (!missing.length) return;
  writePref('kometaFiles', [...known, ...missing.filter((f) => !known.has(f))]);
  writeFiles();
}

/** The line to add under the library in Kometa's config.yml. */
export const kometaFileLine = (lib: Collection['library']) => `config/${SUBDIR}/${fileFor(lib)}`;

const MD = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/;

export interface CollectionInput {
  name: string;
  library: { server: string; id: string };
  source: Collection['source'];
  schedule: Collection['schedule'];
  order: Collection['order'];
  addMissing: boolean;
  visibleHome: boolean;
}

async function validate(input: CollectionInput, ctx: jellyfin.JfCtx, except?: string): Promise<Collection['library']> {
  const libs = await libraries(ctx);
  const lib = libs.find((l) => l.server === input.library.server && l.id === input.library.id);
  if (!lib) throw new HttpError(400, 'Pick a library.', 'library');
  if (list.some((c) => c.id !== except && c.name.toLowerCase() === input.name.toLowerCase() && c.library.server === lib.server && c.library.id === lib.id)) {
    throw new HttpError(400, 'There’s already a collection with that name in this library.', 'name');
  }
  const s = input.source;
  if (s.type === 'manual' && !s.ids?.length) throw new HttpError(400, 'Pick at least one title.', 'source');
  if (['tmdb_list', 'imdb_list', 'trakt_list', 'tmdb_keyword'].includes(s.type) && !s.value?.trim()) throw new HttpError(400, 'Enter the list address or id.', 'source');
  if (s.type === 'imdb_list' && !/^https:\/\/(www\.)?imdb\.com\/list\/ls\d+/.test(s.value!)) throw new HttpError(400, 'Enter an IMDb list address, like https://www.imdb.com/list/ls000096828/', 'source');
  if (s.type === 'trakt_list' && !/^https:\/\/(www\.)?trakt\.tv\//.test(s.value!)) throw new HttpError(400, 'Enter a Trakt list address.', 'source');
  if ((s.type === 'tmdb_list' || s.type === 'tmdb_keyword') && !/^\d+$|^https:\/\/(www\.)?themoviedb\.org\//.test(s.value!)) throw new HttpError(400, 'Enter a TMDb id or address.', 'source');
  if (input.schedule !== 'always' && (!MD.test(input.schedule.from) || !MD.test(input.schedule.to))) throw new HttpError(400, 'Use month/day dates, like 12/01.', 'schedule');
  return lib;
}

export async function createCollection(input: CollectionInput, ctx: jellyfin.JfCtx, by: string) {
  if (!folderState().ok) throw new HttpError(400, 'Set Kometa’s config folder in Settings first.', 'not_configured');
  const library = await validate(input, ctx);
  const now = new Date().toISOString();
  const c: Collection = { ...input, name: input.name.trim(), library, id: `sf-${randomBytes(5).toString('hex')}`, createdBy: by, createdAt: now, updatedAt: now };
  list = [...list, c];
  save();
  return c;
}

export async function updateCollection(id: string, input: CollectionInput, ctx: jellyfin.JfCtx) {
  const cur = getCollection(id);
  if (!cur) throw new HttpError(404, 'Unknown collection', 'not_found');
  const library = await validate(input, ctx, id);
  const next: Collection = { ...cur, ...input, name: input.name.trim(), library, updatedAt: new Date().toISOString() };
  list = list.map((c) => (c.id === id ? next : c));
  save();
  return next;
}

export function deleteCollection(id: string) {
  const cur = getCollection(id);
  if (!cur) throw new HttpError(404, 'Unknown collection', 'not_found');
  list = list.filter((c) => c.id !== id);
  save();
  return cur;
}

/* ------------------------------ servers & libraries ------------------------------ */

/** A server target for reading collections: extra servers, or the main Jellyfin server with its API key. */
function target(serverId: string): (jellyfin.JfServerTarget & { type: 'jellyfin' | 'plex' | 'emby' }) | undefined {
  if (serverId === 'jellyfin') {
    const s = resolve('jellyfin').settings;
    return s.url && s.apiKey ? { id: 'jellyfin', name: 'Jellyfin', url: s.url, apiKey: s.apiKey, type: 'jellyfin' } : undefined;
  }
  return mediaServer(serverId);
}

/** Movie and TV libraries on every media server. */
export async function libraries(ctx: jellyfin.JfCtx) {
  return cache.get('kometa:col:libraries', 60_000, async () => {
    const servers: { id: string; type: 'jellyfin' | 'plex' | 'emby'; name: string }[] = [];
    const main = target('jellyfin');
    if (main) servers.push({ id: 'jellyfin', type: 'jellyfin', name: (await jellyfin.publicInfo().catch(() => undefined))?.ServerName ?? 'Jellyfin' });
    for (const s of mediaServers()) servers.push({ id: s.id, type: s.type, name: s.name });
    const lists = await Promise.all(
      servers.map(async (srv) => {
        const t = target(srv.id);
        if (!t) return [];
        const libs = await (srv.type === 'plex' ? plex.movieAndShowLibraries(t) : jellyfin.remoteMovieAndShowLibraries(t)).catch(() => []);
        return libs.map((l) => ({ server: srv.id, serverType: srv.type, serverName: srv.name, id: l.id, name: l.name, kind: l.kind }));
      }),
    );
    void ctx;
    return lists.flat();
  });
}

interface ServerCollection {
  id: string;
  name: string;
  count: number;
  poster?: jellyfin.ArtworkRef;
}

/** Collections that exist on a library's server. Jellyfin and Emby keep collections server-wide. */
async function serverCollections(lib: Collection['library']): Promise<ServerCollection[]> {
  const t = target(lib.server);
  if (!t) return [];
  return cache.get(`kometa:col:server:${lib.server}:${lib.serverType === 'plex' ? lib.id : 'all'}`, 60_000, () =>
    (lib.serverType === 'plex' ? plex.collections(t, lib.id) : jellyfin.remoteCollections(t)).catch(() => [] as ServerCollection[]),
  );
}

/* ---------------------------------- the list ---------------------------------- */

interface Event {
  at: number;
  data: { event: string; collection?: string; library?: string; created?: boolean; addedCount?: number; removedCount?: number; additions?: string[]; removals?: string[]; error?: string; message?: string };
}

function events(name: string) {
  const rows = db.prepare("SELECT at, data FROM kometa_events WHERE event IN ('changes', 'error', 'delete') ORDER BY id DESC LIMIT 1000").all() as unknown as { at: number; data: string }[];
  return rows.map((r) => ({ at: r.at, data: JSON.parse(r.data) as Event['data'] })).filter((e) => e.data.collection === name || (e.data.event === 'delete' && e.data.message?.includes(`“${name}”`)));
}

function lastRun() {
  const end = db.prepare("SELECT at FROM kometa_events WHERE event = 'run_end' ORDER BY id DESC LIMIT 1").get() as { at: number } | undefined;
  const start = db.prepare("SELECT at FROM kometa_events WHERE event = 'run_start' ORDER BY id DESC LIMIT 1").get() as { at: number } | undefined;
  return { end: end?.at, start: start?.at };
}

function statusOf(c: Collection | undefined, onServer: ServerCollection | undefined, evs: { at: number; data: Event['data'] }[]) {
  const run = lastRun();
  const err = evs.find((e) => e.data.event === 'error' && (!run.start || e.at >= run.start));
  if (err) return { status: 'error' as const, error: err.data.error };
  if (onServer) return { status: 'built' as const };
  if (c && (!run.end || run.end < Date.parse(c.updatedAt))) return { status: 'waiting' as const };
  if (c?.schedule !== 'always' && c) return { status: 'scheduled' as const };
  return { status: 'waiting' as const };
}

/** StreamForge's collections, plus the other collections on each library's server (read-only). */
export async function collectionList(ctx: jellyfin.JfCtx) {
  const libs = await libraries(ctx);
  ensureLibraryFiles(libs);
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const run = lastRun();
  for (const c of list) {
    const onServer = (await serverCollections(c.library)).find((x) => x.name.toLowerCase() === c.name.toLowerCase());
    if (onServer) seen.add(`${c.library.server}:${onServer.id}`);
    const evs = events(c.name);
    out.push({
      id: c.id,
      name: c.name,
      managed: true,
      library: c.library,
      source: c.source,
      schedule: c.schedule,
      count: onServer?.count,
      poster: onServer?.poster,
      builtAt: evs.find((e) => e.data.event === 'changes')?.at,
      createdBy: c.createdBy,
      updatedAt: c.updatedAt,
      waitingForRun: !run.end || run.end < Date.parse(c.updatedAt),
      ...statusOf(c, onServer, evs),
    });
  }
  // Collections already on the servers, from your own Kometa files or made by hand.
  const done = new Set<string>();
  for (const lib of libs) {
    const key = lib.serverType === 'plex' ? `${lib.server}:${lib.id}` : lib.server;
    if (done.has(key)) continue;
    done.add(key);
    for (const sc of await serverCollections(lib)) {
      if (seen.has(`${lib.server}:${sc.id}`)) continue;
      out.push({
        id: `srv~${lib.server}~${lib.serverType === 'plex' ? lib.id : ''}~${sc.id}`,
        name: sc.name,
        managed: false,
        library: lib.serverType === 'plex' ? lib : { ...lib, id: '', name: 'Collections', kind: lib.kind },
        count: sc.count,
        poster: sc.poster,
        status: 'built',
      });
    }
  }
  return {
    settings: collectionSettings(),
    nextRun: nextRun(),
    libraries: libs.map((l) => ({ ...l, kometaFile: kometaFileLine(l) })),
    collections: out,
  };
}

/* --------------------------------- the detail --------------------------------- */

const TMDB = process.env.TMDB_API_URL || 'https://api.themoviedb.org/3';

interface TmdbTitle {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string;
  media_type?: string;
}

/** What the source holds, from TMDb, when it can be worked out (IMDb and Trakt lists can't). */
async function sourceTitles(c: Collection): Promise<TmdbTitle[] | undefined> {
  const key = tmdbKey();
  const s = c.source;
  if (s.type === 'imdb_list' || s.type === 'trakt_list') return undefined;
  const kind = c.library.kind === 'movie' ? 'movie' : 'tv';
  const get = <T>(p: string, query: Record<string, string | number> = {}) => requestJson<T>(buildUrl(TMDB, p, { api_key: key, ...query }), { service: 'tmdb', timeoutMs: 15_000 });
  return cache.get(`kometa:col:src:${c.id}:${c.updatedAt}`, 30 * 60_000, async () => {
    if (!key) return undefined;
    const id = (v?: string) => v?.match(/(\d+)/)?.[1];
    if (s.type === 'manual') {
      return Promise.all((s.ids ?? []).slice(0, 100).map((n) => get<TmdbTitle>(`/${kind}/${n}`).catch(() => ({ id: n }) as TmdbTitle)));
    }
    if (s.type === 'tmdb_list') {
      const out: TmdbTitle[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await get<{ items: TmdbTitle[]; total_pages?: number }>(`/list/${id(s.value)}`, { page });
        out.push(...r.items.filter((i) => !i.media_type || i.media_type === kind));
        if (!r.total_pages || page >= r.total_pages) break;
      }
      return out;
    }
    const limit = s.limit ?? 30;
    const path = s.type === 'tmdb_trending_weekly' ? `/trending/${kind}/week` : s.type === 'tmdb_popular' ? `/${kind}/popular` : `/discover/${kind}`;
    const out: TmdbTitle[] = [];
    for (let page = 1; out.length < limit && page <= 10; page++) {
      const r = await get<{ results: TmdbTitle[] }>(path, s.type === 'tmdb_keyword' ? { with_keywords: id(s.value) ?? '', page } : { page });
      if (!r.results.length) break;
      out.push(...r.results);
    }
    return out.slice(0, limit);
  }).catch(() => undefined);
}

const yearOf = (t: TmdbTitle) => Number((t.release_date ?? t.first_air_date ?? '').slice(0, 4)) || undefined;

/** Everything the collection page shows. */
export async function collectionDetail(id: string, ctx: jellyfin.JfCtx) {
  let c = getCollection(id);
  let lib: Collection['library'];
  let serverCol: ServerCollection | undefined;
  if (c) {
    lib = c.library;
    serverCol = (await serverCollections(lib)).find((x) => x.name.toLowerCase() === c!.name.toLowerCase());
  } else {
    const [, server, libId, colId] = id.split('~');
    const libs = await libraries(ctx);
    const l = libs.find((x) => x.server === server && (x.serverType !== 'plex' || x.id === libId));
    if (!l || !colId) throw new HttpError(404, 'Unknown collection', 'not_found');
    lib = l.serverType === 'plex' ? l : { ...l, id: '', name: 'Collections' };
    serverCol = (await serverCollections(lib)).find((x) => x.id === colId);
    if (!serverCol) throw new HttpError(404, 'Unknown collection', 'not_found');
  }
  const t = target(lib.server);
  const items = serverCol && t ? await (lib.serverType === 'plex' ? plex.collectionItems(t, serverCol.id) : jellyfin.remoteCollectionItems(t, serverCol.id)).catch(() => []) : [];
  const evs = events(c?.name ?? serverCol!.name);
  const source = c ? await sourceTitles(c) : undefined;

  // What's in the server's library, to tell which source titles are missing.
  const libItems = (await allLibraryItems(ctx).catch(() => ({ items: [] as { tmdb?: string; server: LibraryServer }[] }))).items.filter((i) => i.server.id === lib.server);
  const have = new Set(libItems.flatMap((i) => idKeys(i)));
  const inCollection = new Set(items.flatMap((i) => idKeys(i)));
  const lastAdded = new Set(evs.find((e) => e.data.event === 'changes')?.data.additions ?? []);
  const titles = source
    ? source.map((s) => {
        const k = `tmdb:${s.id}`;
        return {
          tmdbId: s.id,
          title: s.title ?? s.name ?? `TMDb ${s.id}`,
          year: yearOf(s),
          poster: s.poster_path ? `https://image.tmdb.org/t/p/w342${s.poster_path}` : undefined,
          inLibrary: have.has(k),
          inCollection: inCollection.has(k),
          new: lastAdded.has(s.title ?? s.name ?? ''),
        };
      })
    : items.map((i) => ({ tmdbId: i.tmdb ? Number(i.tmdb) : undefined, title: i.title, year: i.year, poster: i.poster, inLibrary: true, inCollection: true, new: lastAdded.has(i.title) }));

  const server = mediaServer(lib.server);
  const libServer: LibraryServer = { id: lib.server, type: lib.serverType, name: lib.serverName, main: false, openUrl: server?.publicUrl || server?.url, serverId: server?.serverId };
  return {
    id,
    name: c?.name ?? serverCol!.name,
    managed: !!c,
    collection: c,
    library: lib,
    kometaFile: c ? kometaFileLine(lib) : undefined,
    yaml: c ? `collections:\n${entry(c)}` : undefined,
    poster: serverCol?.poster,
    openUrl: serverCol ? openLink(libServer, serverCol.id) : undefined,
    ...statusOf(c, serverCol, evs),
    nextRun: nextRun(),
    /** False when the source can't be read (IMDb/Trakt lists, or no TMDb key): only the built collection is known. */
    sourceKnown: !!source,
    counts: {
      onList: source?.length,
      inLibrary: titles.filter((x) => x.inLibrary).length,
      missing: source ? titles.filter((x) => !x.inLibrary).length : undefined,
      inCollection: items.length,
    },
    titles,
    history: evs.slice(0, 20).map((e) => ({ at: new Date(e.at).toISOString(), ...e.data })),
  };
}

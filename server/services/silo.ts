import { randomUUID } from 'node:crypto';
import { buildUrl, requestJson, requestRaw, UpstreamError } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import type { ArtworkRef, JfServerTarget, NowPlaying } from './jellyfin.js';
import type { HealthProbe } from './types.js';

/*
 * Silo (https://siloserver.org), through its native API at /api/v2.
 *
 * Silo is pre-release, so this sticks to the parts of the API its docs call
 * accepted for 1.0, and every reader tolerates missing fields. StreamForge
 * uses an admin API key (`sa_…`, created at setup) for everything except
 * signing people in, which uses POST /api/v2/auth/login.
 *
 * Everything here returns the same shapes as the Plex and Jellyfin functions,
 * so the rest of StreamForge treats Silo like any other media server.
 *
 * Artwork: Silo serves signed, public image URLs under /api/v2/artwork/. A
 * ref carries the path after that prefix in `tag`; the image proxy fetches it
 * from the Silo server, so the browser never talks to Silo directly.
 */

const base = (url: string) => url.replace(/\/+$/, '');
const ARTWORK = '/api/v2/artwork/';

function headers(apiKey: string, profile?: string): Record<string, string> {
  return { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, ...(profile ? { 'X-Profile-Id': profile } : {}) };
}

function silo<T>(srv: Pick<JfServerTarget, 'url' | 'apiKey'>, path: string, query?: Record<string, string | number | boolean | undefined>, profile?: string) {
  return requestJson<T>(buildUrl(base(srv.url), `/api/v2${path}`, query), { headers: headers(srv.apiKey, profile), service: 'jellyfin' });
}

function post<T>(srv: Pick<JfServerTarget, 'url' | 'apiKey'>, path: string, body: unknown) {
  return requestJson<T>(buildUrl(base(srv.url), `/api/v2${path}`), { method: 'POST', headers: headers(srv.apiKey), body, service: 'jellyfin' });
}

interface Page<T> {
  items?: T[];
  page?: { has_more?: boolean; next_cursor?: string };
}

/** Every page of a paged list (Silo caps most pages at 200, some at 50). */
async function all<T>(srv: JfServerTarget, path: string, query: Record<string, string | number | undefined> = {}, max = 5000, pageSize = 200) {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const res = await silo<Page<T>>(srv, path, { ...query, limit: pageSize, cursor });
    out.push(...(res.items ?? []));
    cursor = res.page?.has_more ? res.page.next_cursor : undefined;
  } while (cursor && out.length < max);
  return out;
}

/* --------------------------------- types --------------------------------- */

interface SiloVersion {
  file_id?: string;
  library_id?: string;
  resolution?: string;
  codec_video?: string;
  dynamic_range?: string;
  codec_audio?: string;
  audio_channels?: number;
  container?: string;
  bitrate_kbps?: number;
  file_size?: number;
  path?: string;
}

interface SiloItem {
  content_id: string;
  type: 'movie' | 'series' | 'episode' | string;
  title: string;
  year?: number;
  tmdb_id?: string;
  tvdb_id?: string;
  imdb_id?: string;
  series_id?: string;
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  library_ids?: string[];
  added_at?: string;
  versions?: SiloVersion[];
  poster_url?: string;
  backdrop_url?: string;
  series_poster_url?: string;
  series_backdrop_url?: string;
  overview?: string;
  tagline?: string;
  genres?: string[];
  studios?: string[];
  networks?: string[];
  content_rating?: string;
  rating_tmdb?: number;
  runtime?: number;
  release_date?: string;
  first_air_date?: string;
  season_count?: number;
  cast?: { name: string; character?: string; photo_url?: string }[];
}

interface SiloSession {
  session_id: string;
  user_id: string;
  username: string;
  profile_name?: string;
  media_item_id?: string;
  media_title: string;
  media_type: string;
  series_title?: string;
  season_number?: number;
  episode_number?: number;
  poster_url?: string;
  position_seconds: number;
  file_duration?: number | null;
  is_paused: boolean;
  play_method: string;
  effective_play_method?: string;
  video_decision?: string;
  audio_decision?: string;
  transcode_audio?: boolean;
  client_name?: string;
  client_label?: string;
  client_version?: string;
  client_ip?: string;
  device_id?: string;
  device_platform?: string;
  started_at: string;
  updated_at?: string;
  source_video_codec?: string;
  source_video_height?: number;
  source_video_resolution?: string;
  source_audio_codec?: string;
  source_audio_channels?: number | null;
  source_audio_layout?: string;
  source_container?: string;
  source_bitrate_kbps?: number | null;
  stream_bitrate_kbps?: number | null;
  target_video_codec?: string;
  target_audio_codec?: string;
  target_resolution?: string;
  target_bitrate_kbps?: number | null;
  output_container?: string;
  transcode_hw_accel?: string;
  adaptation_reasons?: string[];
  stream_location?: 'local' | 'remote';
  subtitle?: { codec?: string | null; delivery?: string };
}

interface SiloPlay {
  session_id: string;
  user_id: string;
  username: string;
  profile_name?: string;
  media_item_id: string;
  media_title: string;
  media_type: string;
  series_title?: string;
  season_number?: number | null;
  episode_number?: number | null;
  started_at: string;
  ended_at: string;
  completed: boolean;
  played_seconds?: number | null;
  play_method: string;
  video_decision?: string | null;
  audio_decision?: string | null;
  client_name?: string | null;
  device_platform?: string | null;
}

interface SiloUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  enabled: boolean;
  is_owner?: boolean;
  last_active_at?: string | null;
}

interface SiloLibrary {
  id: string;
  name: string;
  type: string;
  paths?: string[];
  enabled?: boolean;
  last_scanned_at?: string;
}

/* ------------------------------ health, setup ------------------------------ */

/** Public server name (shown on Silo's sign-in page). */
async function serverName(url: string) {
  const b = await requestJson<{ server_name?: string }>(buildUrl(base(url), '/api/v2/theme/branding'), { service: 'jellyfin' }).catch(() => undefined);
  return b?.server_name || undefined;
}

/**
 * Checks a Silo server. `/system/info` needs no key and confirms it's Silo
 * (`api_major` 2); with a key, the build and admin access are checked too.
 */
export async function probe(target: { url: string; apiKey?: string }): Promise<HealthProbe> {
  const info = await requestJson<{ api_major?: number; server_version?: string }>(buildUrl(base(target.url), '/api/v2/system/info'), { service: 'jellyfin' }).catch((err) => {
    throw err instanceof UpstreamError && err.status === 404 ? new UpstreamError('This does not look like a Silo server', 404, 'jellyfin') : err;
  });
  if (info?.api_major !== 2) throw new UpstreamError('This does not look like a Silo server (it needs Silo’s /api/v2)', undefined, 'jellyfin');
  const result: HealthProbe = { version: info.server_version, issues: [], meta: { server: await serverName(target.url) } };
  if (target.apiKey) {
    const build = await silo<{ display?: string; build_number?: number }>({ url: target.url, apiKey: target.apiKey }, '/admin/system/build').catch((err) => {
      throw err instanceof UpstreamError && (err.status === 401 || err.status === 403) ? new UpstreamError('The Silo API key was refused, or isn’t an admin key', err.status, 'jellyfin') : err;
    });
    if (build?.build_number) result.version = `${build.display ?? info.server_version} (build ${build.build_number})`;
    const status = await silo<{ restart_required?: boolean }>({ url: target.url, apiKey: target.apiKey }, '/admin/server/status').catch(() => undefined);
    if (status?.restart_required) result.issues.push({ level: 'warning', message: 'Silo needs a restart to apply a settings change' });
  }
  return result;
}

/** The server's own id, for deep links; needs no key. */
export async function identity(url: string) {
  const r = await requestJson<{ server_id?: string }>(buildUrl(base(url), '/api/v2/system/identity'), { service: 'jellyfin' }).catch(() => undefined);
  return r?.server_id;
}

export interface SiloSignIn {
  accessToken: string;
  /** Kept server-side so requests can be made in the person's own name. */
  refreshToken?: string;
  user: { id: string; username: string; role: 'admin' | 'user' };
}

/** Signs a person in with their Silo username and password. */
export async function login(url: string, username: string, password: string): Promise<SiloSignIn> {
  const r = await requestJson<{ access_token: string; refresh_token?: string; user: SiloSignIn['user'] }>(buildUrl(base(url), '/api/v2/auth/login'), {
    method: 'POST',
    headers: { 'X-Silo-Device-Id': 'streamforge-server', 'X-Silo-Device-Name': 'StreamForge', 'X-Silo-Device-Platform': 'server' },
    body: { username, password },
    service: 'jellyfin',
  }).catch((err) => {
    throw err instanceof UpstreamError && (err.status === 401 || err.status === 400 || err.status === 422) ? new UpstreamError('Wrong Silo username or password', 401, 'jellyfin') : err;
  });
  return { accessToken: r.access_token, refreshToken: r.refresh_token, user: r.user };
}

/** Creates StreamForge's admin API key with an admin's session (setup). */
export async function createApiKey(url: string, accessToken: string) {
  const r = await requestJson<{ key: string }>(buildUrl(base(url), '/api/v2/admin/api-keys'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    // No scopes: an admin key, needed for sessions, history, scans and the catalog.
    body: { label: 'StreamForge', scopes: [] },
    service: 'jellyfin',
  });
  if (!r?.key?.startsWith('sa_')) throw new UpstreamError('Silo didn’t return an API key', undefined, 'jellyfin');
  return r.key;
}

/** Whether a person's Silo account still exists and is enabled (session revalidation). */
export async function userStatus(srv: JfServerTarget, userId: string) {
  const users = await accounts(srv);
  return users.find((u) => u.id === userId);
}

/* ------------------------------- now playing ------------------------------ */

const TYPE: Record<string, string> = { movie: 'Movie', episode: 'Episode', series: 'Series', season: 'Season', track: 'Audio', audiobook: 'AudioBook' };

/** A Silo artwork URL → an artwork ref the image proxy understands. */
function art(url: string | undefined, itemId: string, type: ArtworkRef['type'], server: string): ArtworkRef | undefined {
  if (!url) return undefined;
  const at = url.indexOf(ARTWORK);
  if (at < 0) return undefined;
  return { itemId: itemId.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 100) || 'item', type, tag: url.slice(at + ARTWORK.length), server };
}

function resolutionLabel(height?: number, label?: string) {
  if (height) {
    if (height >= 2100) return '4K';
    if (height >= 1400) return '1440p';
    if (height >= 1000) return '1080p';
    if (height >= 700) return '720p';
    if (height >= 560) return '576p';
    return `${height}p`;
  }
  if (!label) return undefined;
  return /^(2160p|4k|uhd)$/i.test(label) ? '4K' : label;
}

/** Item details, cached, for artwork and overviews that sessions don't carry. */
async function itemDetail(srv: JfServerTarget, id: string) {
  if (!isValidId(id)) return undefined;
  return cache.get(`silo:${srv.id}:item:${id}`, 10 * 60_000, async () => {
    const profile = await profileId(srv);
    return silo<SiloItem>(srv, `/catalog/items/${encodeURIComponent(id)}`, { poster_width: 500, backdrop_width: 1280 }, profile);
  }).catch(() => undefined);
}

function playMethod(s: { play_method?: string; effective_play_method?: string; video_decision?: string | null; audio_decision?: string | null }): 'DirectPlay' | 'DirectStream' | 'Transcode' {
  const m = (s.effective_play_method || s.play_method || '').toLowerCase();
  if (m.includes('transcode') || s.video_decision === 'transcode' || s.audio_decision === 'transcode') return 'Transcode';
  if (m.includes('stream') || m.includes('remux') || s.video_decision === 'remux') return 'DirectStream';
  return 'DirectPlay';
}

async function normalise(s: SiloSession, srv: JfServerTarget): Promise<NowPlaying> {
  const ep = s.media_type === 'episode';
  const detail = s.media_item_id ? await itemDetail(srv, s.media_item_id) : undefined;
  const runtimeMs = Math.round((s.file_duration ?? (detail?.runtime ? detail.runtime * 60 : 0)) * 1000);
  const positionMs = Math.round(s.position_seconds * 1000);
  const method = playMethod(s);
  const id = s.media_item_id ?? s.session_id;
  const poster = art(ep ? (detail?.series_poster_url ?? s.poster_url) : (detail?.poster_url ?? s.poster_url), id, 'Primary', srv.id);
  const backdrop = art(ep ? (detail?.series_backdrop_url ?? detail?.backdrop_url) : detail?.backdrop_url, id, 'Backdrop', srv.id);
  return {
    sessionId: s.session_id,
    user: { id: s.user_id, name: s.profile_name && s.profile_name !== s.username ? `${s.username} · ${s.profile_name}` : s.username, imageTag: undefined },
    client: s.client_name ?? s.client_label,
    device: s.client_label ?? s.device_platform,
    deviceId: s.device_id,
    appVersion: s.client_version,
    remoteAddress: s.client_ip,
    lastActivity: s.updated_at,
    item: {
      id,
      type: TYPE[s.media_type] ?? 'Video',
      mediaType: s.media_type === 'track' || s.media_type === 'audiobook' ? 'Audio' : 'Video',
      title: s.media_title,
      seriesName: ep ? s.series_title : undefined,
      seasonNumber: ep ? s.season_number : undefined,
      episodeNumber: ep ? s.episode_number : undefined,
      album: undefined,
      artist: undefined,
      year: detail?.year,
      overview: detail?.overview,
      genres: detail?.genres?.slice(0, 3) ?? [],
      officialRating: detail?.content_rating,
      communityRating: detail?.rating_tmdb,
      runtimeMs,
      resolution: resolutionLabel(s.source_video_height, s.source_video_resolution),
      hdr: undefined,
      videoCodec: s.source_video_codec,
      bitrate: s.source_bitrate_kbps ? s.source_bitrate_kbps * 1000 : undefined,
      frameRate: undefined,
      audio: [s.source_audio_codec?.toUpperCase(), s.source_audio_layout].filter(Boolean).join(' ') || undefined,
      poster,
      backdrop,
      logo: undefined,
      thumb: undefined,
    },
    media: {
      container: s.source_container,
      bitrate: s.source_bitrate_kbps ? s.source_bitrate_kbps * 1000 : undefined,
      video: s.source_video_codec ? { codec: s.source_video_codec, range: undefined, bitDepth: undefined, width: undefined, height: s.source_video_height } : undefined,
      audio: s.source_audio_codec ? { codec: s.source_audio_codec, channels: s.source_audio_channels ?? undefined } : undefined,
      subtitle: s.subtitle?.codec ? { codec: s.subtitle.codec } : undefined,
    },
    state: {
      positionMs,
      progress: runtimeMs > 0 ? Math.min(1, positionMs / runtimeMs) : 0,
      isPaused: s.is_paused,
      isMuted: false,
      playMethod: method,
    },
    transcode:
      method === 'DirectPlay'
        ? undefined
        : {
            videoCodec: s.target_video_codec,
            audioCodec: s.target_audio_codec,
            container: s.output_container,
            bitrate: s.target_bitrate_kbps ? s.target_bitrate_kbps * 1000 : s.stream_bitrate_kbps ? s.stream_bitrate_kbps * 1000 : undefined,
            resolution: s.target_resolution,
            framerate: undefined,
            isVideoDirect: s.video_decision !== 'transcode',
            isAudioDirect: s.audio_decision !== 'transcode' && !s.transcode_audio,
            completion: undefined,
            hwAccel: s.transcode_hw_accel,
            reasons: s.adaptation_reasons ?? [],
          },
    server: srv.id,
    serverName: srv.name,
    serverType: 'silo',
  };
}

async function sessions(srv: JfServerTarget) {
  return cache.get(`silo:${srv.id}:sessions`, 2_000, async () => (await silo<Page<SiloSession>>(srv, '/admin/sessions', { limit: 200 })).items ?? []);
}

/** Active streams. */
export async function nowPlaying(srv: JfServerTarget) {
  return Promise.all((await sessions(srv)).map((s) => normalise(s, srv)));
}

/** Stops, pauses, resumes or messages a stream. */
export async function controlSession(srv: JfServerTarget, sessionId: string, command: 'stop' | 'pause' | 'resume' | 'message', text?: string) {
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(sessionId)) throw new UpstreamError('Unknown session', 400, 'jellyfin');
  const body: Record<string, unknown> = { command_id: randomUUID(), sequence: Date.now() };
  if (command === 'message') Object.assign(body, { title: 'StreamForge', message: text || 'Message from the server admin' });
  else if (text) body.reason = text;
  await post(srv, `/admin/sessions/${encodeURIComponent(sessionId)}/${command}`, body);
  cache.delete(`silo:${srv.id}:sessions`);
}

/* -------------------------------- overview -------------------------------- */

const accounts = (srv: JfServerTarget) => cache.get(`silo:${srv.id}:users`, 60_000, () => all<SiloUser>(srv, '/admin/users'));

/** The admin key's own profile, for catalog calls that need one. */
async function profileId(srv: JfServerTarget) {
  return cache.get(`silo:${srv.id}:profile`, 60 * 60_000, async () => {
    const r = await silo<{ items?: { id: string; is_primary?: boolean }[] }>(srv, '/profiles');
    return (r.items?.find((p) => p.is_primary) ?? r.items?.[0])?.id;
  });
}

/** Libraries (not paged: Silo rejects paging parameters here). */
async function libraries(srv: JfServerTarget) {
  return (await silo<Page<SiloLibrary>>(srv, '/libraries')).items ?? [];
}

const LIBRARY_TYPE: Record<string, string> = { movies: 'movies', series: 'tvshows', mixed: 'mixed', music: 'music', audiobooks: 'books', ebooks: 'books' };

/** Every movie, series and episode, from the admin catalog (cached). */
async function catalog(srv: JfServerTarget, type: 'movie' | 'series' | 'episode') {
  return cache.get(`silo:${srv.id}:catalog:${type}`, 5 * 60_000, () => all<SiloItem>(srv, '/admin/catalog/items', { type }, 20_000));
}

/** The same shape as `jellyfin.remoteOverview`. */
export async function overview(srv: JfServerTarget) {
  const p = `silo:${srv.id}:`;
  const [name, build, stats, libs, users, sessionList, movies, series] = await Promise.all([
    serverName(srv.url),
    cache.get(`${p}build`, 60_000, () => silo<{ display?: string; build_number?: number }>(srv, '/admin/system/build')).catch(() => undefined),
    cache.get(`${p}stats`, 60_000, () =>
      silo<{ total_movies?: number; total_shows?: number; total_show_files?: number; total_users?: number }>(srv, '/admin/stats'),
    ).catch(() => undefined),
    cache.get(`${p}libraries`, 5 * 60_000, () => libraries(srv)),
    accounts(srv),
    sessions(srv),
    catalog(srv, 'movie').catch(() => [] as SiloItem[]),
    catalog(srv, 'series').catch(() => [] as SiloItem[]),
  ]);
  const count = (lib: SiloLibrary) => [...movies, ...series].filter((i) => i.library_ids?.includes(lib.id)).length;
  const dayAgo = Date.now() - 86_400_000;
  const playing = new Set(sessionList.map((s) => s.user_id));
  const isTranscode = (s: SiloSession) => playMethod(s) === 'Transcode';
  return {
    server: {
      id: srv.id,
      name: name ?? srv.name,
      version: build?.display ? `${build.display}${build.build_number ? ` (build ${build.build_number})` : ''}` : '',
      os: undefined as string | undefined,
      architecture: undefined as string | undefined,
      hasUpdateAvailable: false,
      hasPendingRestart: false,
    },
    counts: {
      movies: stats?.total_movies ?? movies.length,
      series: stats?.total_shows ?? series.length,
      episodes: stats?.total_show_files ?? 0,
      albums: 0,
      songs: 0,
      artists: 0,
      books: 0,
      musicVideos: 0,
      collections: 0,
    },
    libraries: libs.map((l) => ({
      id: l.id,
      name: l.name,
      type: LIBRARY_TYPE[l.type] ?? 'mixed',
      locations: l.paths ?? [],
      itemCount: count(l),
      refreshing: false,
      refreshProgress: undefined as number | undefined,
      image: undefined as ArtworkRef | undefined,
    })),
    users: {
      total: users.length,
      active24h: users.filter((u) => (u.last_active_at && Date.parse(u.last_active_at) > dayAgo) || playing.has(u.id)).length,
      list: users
        .map((u) => ({ id: u.id, name: u.username, imageTag: undefined as string | undefined, isAdmin: u.role === 'admin', lastActivity: u.last_active_at ?? undefined }))
        .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '')),
    },
    sessions: {
      active: sessionList.length,
      streams: sessionList.length,
      transcoding: sessionList.filter(isTranscode).length,
      directPlay: sessionList.filter((s) => !isTranscode(s)).length,
    },
  };
}

/** Newest movies and episodes. */
export async function latest(srv: JfServerTarget, limit = 20) {
  return cache.get(`silo:${srv.id}:latest:${limit}`, 60_000, async () => {
    const [movies, episodes] = await Promise.all([catalog(srv, 'movie'), catalog(srv, 'episode')]);
    return [...movies, ...episodes]
      .sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''))
      .slice(0, limit)
      .map((m) => {
        const ep = m.type === 'episode';
        return {
          id: m.content_id,
          type: TYPE[m.type] ?? m.type,
          title: ep ? (m.series_title ?? m.title) : m.title,
          subtitle: ep ? `S${m.season_number ?? 0}·E${m.episode_number ?? 0} — ${m.title}` : undefined,
          year: m.year,
          added: m.added_at,
          rating: m.rating_tmdb,
          poster: art(m.poster_url, ep ? (m.series_id ?? m.content_id) : m.content_id, 'Primary', srv.id),
          backdrop: undefined as ArtworkRef | undefined,
          logo: undefined as ArtworkRef | undefined,
          thumb: undefined as ArtworkRef | undefined,
        };
      });
  });
}

/* ------------------------------- history -------------------------------- */

const playsSinceRaw = (srv: JfServerTarget, since: number) =>
  // Cached per hour of `since`, like the other servers' history readers.
  cache.get(`silo:${srv.id}:plays:${new Date(since).toISOString().slice(0, 13)}`, 5 * 60_000, () =>
    all<SiloPlay>(srv, '/admin/playback-history', { started_after: new Date(since).toISOString() }, 10_000),
  );

const who = (p: { username: string; profile_name?: string | null }) => (p.profile_name && p.profile_name !== p.username ? `${p.username} · ${p.profile_name}` : p.username);
const playTitle = (p: SiloPlay) =>
  p.media_type === 'episode' && p.series_title
    ? `${p.series_title} - S${String(p.season_number ?? 0).padStart(2, '0')}E${String(p.episode_number ?? 0).padStart(2, '0')} - ${p.media_title}`
    : p.media_title;

/** Silo's playback history as an activity feed. */
export async function activity(srv: JfServerTarget, limit = 25) {
  const res = await cache.get(`silo:${srv.id}:activity:${limit}`, 15_000, () => silo<Page<SiloPlay>>(srv, '/admin/playback-history', { limit }));
  return (res.items ?? []).map((p) => ({
    id: p.session_id,
    name: `${who(p)} ${p.completed ? 'finished' : 'watched'} ${p.media_type === 'episode' && p.series_title ? `${p.series_title} S${p.season_number ?? 0}·E${p.episode_number ?? 0}` : p.media_title}`,
    overview: p.media_type === 'episode' ? p.media_title : undefined,
    type: 'VideoPlayback',
    date: p.started_at,
    severity: 'Information',
    userId: p.user_id,
  }));
}

/** Plays since a time, for stats and watch history (with watch time and delivery). */
export async function playsSince(srv: JfServerTarget, since: number) {
  return (await playsSinceRaw(srv, since)).map((p) => ({
    user: who(p),
    userId: p.user_id,
    title: playTitle(p),
    group: p.media_type === 'episode' ? (p.series_title ?? p.media_title) : p.media_title,
    at: Date.parse(p.started_at),
    watchedMs: p.played_seconds ? Math.round(p.played_seconds * 1000) : undefined,
    method: playMethod(p),
    client: p.client_name ?? p.device_platform ?? undefined,
  }));
}

/** Plays per day, like `jellyfin.playbackHistory`. */
export async function playsPerDay(srv: JfServerTarget, days = 14) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.getTime() - (days - 1) * 86_400_000;
  const plays = await playsSince(srv, since);
  const buckets = new Map<string, { date: string; plays: number; users: Set<string> }>();
  for (let i = 0; i < days; i++) {
    const key = new Date(since + i * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
    buckets.set(key, { date: key, plays: 0, users: new Set() });
  }
  for (const p of plays) {
    const b = buckets.get(new Date(p.at).toISOString().slice(0, 10));
    if (!b) continue;
    b.plays++;
    b.users.add(p.user);
  }
  return [...buckets.values()].map((b) => ({ date: b.date, plays: b.plays, users: b.users.size }));
}

/* ------------------------------ library ------------------------------ */

export function isValidId(id: string) {
  return /^[A-Za-z0-9_.:-]{1,100}$/.test(id);
}

/** Movies and series with their TMDB/TVDB/IMDb ids, like `jellyfin.libraryItems`. */
export async function libraryItems(srv: JfServerTarget) {
  const [movies, series, recent] = await Promise.all([catalog(srv, 'movie'), catalog(srv, 'series'), playsSinceRaw(srv, Date.now() - 400 * 86_400_000).catch(() => [] as SiloPlay[])]);
  // Last time anyone watched each movie or series.
  const titles = new Map<string, number>();
  for (const p of recent) {
    const key = p.media_type === 'episode' ? `s:${p.series_title}` : `m:${p.media_title}`;
    titles.set(key, Math.max(titles.get(key) ?? 0, Date.parse(p.started_at)));
  }
  return [...movies, ...series].map((i) => ({
    id: i.content_id,
    name: i.title,
    type: (i.type === 'series' ? 'Series' : 'Movie') as 'Series' | 'Movie',
    year: i.year,
    tvdb: i.tvdb_id,
    tmdb: i.tmdb_id,
    imdb: i.imdb_id,
    lastPlayed: titles.get(`${i.type === 'series' ? 's' : 'm'}:${i.title}`),
  }));
}

/** Library search, in the same shape as the other search sources. */
export async function search(srv: JfServerTarget, q: string, limit = 12) {
  const profile = await profileId(srv);
  const res = await silo<Page<SiloItem>>(srv, '/catalog', { q, limit: Math.min(limit, 50), poster_width: 300 }, profile);
  return (res.items ?? []).slice(0, limit).map((m) => {
    const kind = TYPE[m.type] ?? m.type;
    const titlePage = m.tmdb_id && /^\d+$/.test(m.tmdb_id) && (m.type === 'movie' || m.type === 'series') ? `/media/${m.type === 'movie' ? 'movie' : 'tv'}/${m.tmdb_id}` : undefined;
    const a = art(m.poster_url, m.content_id, 'Primary', srv.id);
    return {
      key: `silo:${srv.id}:${m.content_id}`,
      source: 'silo' as const,
      title: m.type === 'episode' ? m.title : m.title,
      subtitle: [m.type === 'episode' ? m.series_title : undefined, kind].filter(Boolean).join(' · '),
      year: m.year,
      image: a ? imageUrl(a, 120) : undefined,
      status: 'available' as const,
      path: titlePage ?? `/silo`,
    };
  });
}

/** Scans one library (or all of them) for new files. */
export async function scan(srv: JfServerTarget, library?: string) {
  if (library && !/^[1-9][0-9]{0,8}$/.test(library)) throw new UpstreamError('Unknown library', 400, 'jellyfin');
  const ids = library ? [library] : (await libraries(srv)).map((l) => l.id);
  for (const id of ids) await post(srv, '/scan', { library_id: id });
  cache.delete(`silo:${srv.id}:`);
}

/** What was added since a time, in the weekly digest's shape. */
export async function addedSince(srv: JfServerTarget, since: number) {
  const [movies, episodes] = await Promise.all([catalog(srv, 'movie'), catalog(srv, 'episode')]);
  const recent = (i: SiloItem) => !!i.added_at && Date.parse(i.added_at) >= since;
  const img = (i: SiloItem, id: string) => {
    const a = art(i.poster_url, id, 'Primary', srv.id);
    return a ? imageUrl(a, 200) : undefined;
  };
  const shows = new Map<string, { id: string; title: string; episodes: number; image?: string }>();
  let runtimeMs = 0;
  for (const e of episodes.filter(recent)) {
    const key = e.series_title ?? e.title;
    const s = shows.get(key) ?? { id: e.series_id ?? e.content_id, title: key, episodes: 0, image: img(e, e.series_id ?? e.content_id) };
    s.episodes++;
    shows.set(key, s);
  }
  const added = movies.filter(recent);
  for (const m of added) runtimeMs += (m.runtime ?? 0) * 60_000;
  return {
    movies: added.map((m) => ({ id: m.content_id, title: m.title, year: m.year, image: img(m, m.content_id) })),
    shows: [...shows.values()].sort((a, b) => b.episodes - a.episodes),
    other: [] as { id: string; title: string; kind: string }[],
    runtimeMs,
  };
}

/* ------------------------------ title pages ------------------------------ */

/** A movie or series' details, for title pages nothing else knows. */
export async function itemDetails(srv: JfServerTarget, id: string) {
  const m = await itemDetail(srv, id);
  if (!m) return undefined;
  const episodes = m.type === 'series' ? (await catalog(srv, 'episode').catch(() => [] as SiloItem[])).filter((e) => e.series_id === m.content_id) : [];
  const perSeason = new Map<number, number>();
  for (const e of episodes) if (e.season_number !== undefined) perSeason.set(e.season_number, (perSeason.get(e.season_number) ?? 0) + 1);
  const poster = art(m.poster_url, m.content_id, 'Primary', srv.id);
  const backdrop = art(m.backdrop_url, m.content_id, 'Backdrop', srv.id);
  return {
    title: m.title,
    year: m.year,
    releaseDate: m.release_date ?? m.first_air_date,
    overview: m.overview,
    tagline: m.tagline,
    genres: m.genres ?? [],
    certification: m.content_rating,
    runtimeMin: m.runtime,
    rating: m.rating_tmdb,
    studio: m.networks?.[0] ?? m.studios?.[0],
    poster: poster ? imageUrl(poster, 500) : undefined,
    backdrop: backdrop ? imageUrl(backdrop, 1600) : undefined,
    // Cast photos come from TMDb's own image host; only send them if they're there.
    cast: (m.cast ?? []).slice(0, 20).map((c) => ({ name: c.name, character: c.character, image: undefined as string | undefined })),
    seasons: [...perSeason].sort(([a], [b]) => a - b).map(([number, n]) => ({ number, episodes: n })),
  };
}

/** A movie's copies (quality, size) and when it was added. */
export async function itemFiles(srv: JfServerTarget, id: string, isAdmin: boolean) {
  const movies = await catalog(srv, 'movie').catch(() => [] as SiloItem[]);
  const m = movies.find((x) => x.content_id === id);
  const files = (m?.versions ?? []).map((v, i) => ({
    id: String(v.file_id ?? `${id}-${i}`),
    name: undefined as string | undefined,
    container: v.container,
    size: v.file_size,
    bitrate: v.bitrate_kbps ? v.bitrate_kbps * 1000 : undefined,
    path: isAdmin ? v.path : undefined,
    video: { codec: v.codec_video?.toUpperCase(), resolution: resolutionLabel(undefined, v.resolution), width: undefined, height: undefined, range: v.dynamic_range && v.dynamic_range !== 'sdr' ? v.dynamic_range.toUpperCase() : undefined, bitDepth: undefined, fps: undefined, bitrate: undefined },
    audio: v.codec_audio ? [{ title: undefined as string | undefined, language: undefined as string | undefined, codec: v.codec_audio.toUpperCase(), channels: v.audio_channels ? String(v.audio_channels) : undefined, isDefault: true }] : [],
    subtitles: [] as { title?: string; language?: string; codec?: string; forced: boolean; external: boolean; sdh: boolean; isDefault: boolean }[],
  }));
  return { files, added: m?.added_at };
}

/* ------------------------------ watched ticks ------------------------------ */

/** Silo accounts (id → name). */
export async function accountList(srv: JfServerTarget) {
  return (await accounts(srv)).filter((u) => u.enabled).map((u) => ({ id: u.id, name: u.username }));
}

/**
 * Who has finished each episode of one season of a series, from Silo's
 * playback history (completed plays), keyed by episode number. Accounts are
 * Silo user ids.
 */
export async function seasonWatch(srv: JfServerTarget, seriesId: string, season: number) {
  const out = new Map<number, { accounts: Set<string>; ownerProgress?: number }>();
  if (!isValidId(seriesId)) return out;
  const series = (await catalog(srv, 'series').catch(() => [] as SiloItem[])).find((s) => s.content_id === seriesId);
  if (!series) return out;
  const plays = await playsSinceRaw(srv, 0).catch(() => [] as SiloPlay[]);
  for (const p of plays) {
    if (p.media_type !== 'episode' || p.series_title !== series.title || p.season_number !== season || p.episode_number == null || !p.completed) continue;
    const x = out.get(p.episode_number) ?? out.set(p.episode_number, { accounts: new Set() }).get(p.episode_number)!;
    x.accounts.add(p.user_id);
  }
  return out;
}

/* --------------------------------- images -------------------------------- */

/** StreamForge's proxied URL for a Silo artwork ref. */
function imageUrl(a: ArtworkRef, w: number) {
  return `/api/jellyfin/image/items/${encodeURIComponent(a.itemId)}/${a.type}?w=${w}&tag=${encodeURIComponent(a.tag ?? '')}&server=${encodeURIComponent(a.server ?? '')}`;
}

/** Fetches a Silo artwork image (its signed, public /api/v2/artwork/ URL). */
export function image(srv: JfServerTarget, _id: string, _type: string, opts: { tag?: string }) {
  const tag = opts.tag ?? '';
  // Only Silo's artwork paths: letters, digits and . _ - / with a signature query.
  if (!/^[A-Za-z0-9._/-]{1,300}(\?[A-Za-z0-9=&_.-]{1,300})?$/.test(tag) || tag.includes('..')) return Promise.resolve(new Response(null, { status: 404 }));
  return requestRaw(`${base(srv.url)}${ARTWORK}${tag}`, { headers: { Accept: 'image/*' }, service: 'jellyfin' });
}

/* -------------------------------- requests -------------------------------- */

/*
 * Silo's own request system (Discover, approvals, routing to Sonarr/Radarr
 * through its request integrations). When it's switched on and Silo is the
 * media server, StreamForge's request features use it instead of Seerr.
 *
 * Requests are returned in the same shape as Seerr's, so the Requests page,
 * widget, title pages and search work unchanged. Request ids are strings:
 * Silo's are larger than JavaScript numbers hold exactly.
 */

const TMDB_IMG = 'https://image.tmdb.org/t/p';

interface SiloRequest {
  id: string;
  media_type: 'movie' | 'series';
  tmdb_id: number;
  tvdb_id?: number;
  imdb_id?: string;
  title: string;
  year?: number;
  poster_path?: string;
  backdrop_path?: string;
  status: string;
  state: string;
  outcome: string;
  seasons?: number[];
  requested_by_user_id?: string;
  created_at: string;
  updated_at?: string;
  last_error?: string;
}

/** Whether Silo's requests are switched on (cached briefly). */
export async function requestsEnabled(srv: JfServerTarget) {
  return cache.get(`silo:${srv.id}:requests:on`, 30_000, async () => {
    const c = await silo<{ requests_enabled?: boolean }>(srv, '/admin/requests/counts').catch(() => undefined);
    return !!c?.requests_enabled;
  });
}

/** Silo's request state → Seerr's request status word and media status word. */
function statusOf(r: Pick<SiloRequest, 'state' | 'outcome'>) {
  switch (r.state) {
    case 'pending':
      return { status: 'pending', mediaStatus: 'pending' };
    case 'approved':
      return { status: 'approved', mediaStatus: 'pending' };
    case 'processing':
      return { status: 'approved', mediaStatus: 'processing' };
    case 'partially_available':
      return { status: 'approved', mediaStatus: 'partially available' };
    case 'available':
      return { status: 'approved', mediaStatus: 'available' };
    case 'declined':
    case 'cancelled':
      return { status: 'declined', mediaStatus: 'unknown' };
    case 'failed':
      return { status: 'failed', mediaStatus: 'unknown' };
    default:
      return { status: r.outcome === 'declined' ? 'declined' : 'pending', mediaStatus: 'unknown' };
  }
}

async function normaliseRequest(srv: JfServerTarget, r: SiloRequest) {
  const names = new Map((await accounts(srv).catch(() => [] as SiloUser[])).map((u) => [u.id, u.username]));
  return {
    id: r.id,
    type: (r.media_type === 'series' ? 'tv' : 'movie') as 'movie' | 'tv',
    tmdbId: r.tmdb_id,
    title: r.title,
    year: r.year,
    poster: r.poster_path ? `${TMDB_IMG}/w342${r.poster_path}` : undefined,
    backdrop: r.backdrop_path ? `${TMDB_IMG}/w780${r.backdrop_path}` : undefined,
    ...statusOf(r),
    is4k: false,
    seasons: r.seasons ?? [],
    requestedBy: (r.requested_by_user_id && names.get(r.requested_by_user_id)) || 'Someone',
    modifiedBy: undefined as string | undefined,
    createdAt: r.created_at,
  };
}

/** Recent requests (newest first), optionally one queue view or one person's. */
async function listRequests(srv: JfServerTarget, opts: { view?: 'needs_approval' | 'in_progress' | 'failed' | 'done'; user?: string; limit?: number } = {}) {
  const key = `silo:${srv.id}:requests:${opts.view ?? 'all'}:${opts.user ?? '*'}:${opts.limit ?? 50}`;
  return cache.get(key, 15_000, async () => {
    const res = await silo<Page<SiloRequest>>(srv, '/admin/requests', { view: opts.view, requested_by_user_id: opts.user, limit: Math.min(opts.limit ?? 50, 50) });
    return Promise.all((res.items ?? []).map((r) => normaliseRequest(srv, r)));
  });
}

/** The Requests page, in Seerr's overview shape. */
export async function requestsOverview(srv: JfServerTarget) {
  const [counts, recent, pending, history] = await Promise.all([
    cache.get(`silo:${srv.id}:requests:counts`, 15_000, () =>
      silo<{ needs_approval?: number; in_progress?: number; failed?: number; done?: number }>(srv, '/admin/requests/counts'),
    ),
    listRequests(srv, { limit: 16 }),
    listRequests(srv, { view: 'needs_approval', limit: 12 }),
    // Up to the last 200 requests, for the movie/series split and outcomes.
    cache.get(`silo:${srv.id}:requests:all200`, 30_000, async () => {
      const items = await all<SiloRequest>(srv, '/admin/requests', {}, 200, 50).catch(() => [] as SiloRequest[]);
      return items;
    }),
  ]);
  const by = (f: (r: SiloRequest) => boolean) => history.filter(f).length;
  return {
    counts: {
      total: (counts.needs_approval ?? 0) + (counts.in_progress ?? 0) + (counts.failed ?? 0) + (counts.done ?? 0),
      movie: by((r) => r.media_type === 'movie'),
      tv: by((r) => r.media_type === 'series'),
      pending: counts.needs_approval ?? 0,
      approved: by((r) => r.state === 'approved'),
      declined: by((r) => r.state === 'declined' || r.state === 'cancelled'),
      processing: counts.in_progress ?? 0,
      available: by((r) => r.state === 'available' || r.state === 'partially_available'),
    },
    recent,
    pending,
  };
}

/** Pending requests, for new-request alerts. */
export async function pendingRequests(srv: JfServerTarget) {
  return listRequests(srv, { view: 'needs_approval', limit: 20 });
}

/** One person's requests (by their Silo user id), newest first. */
export async function requestsBy(srv: JfServerTarget, userId: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(userId)) return [];
  return listRequests(srv, { user: userId, limit: 20 });
}

/**
 * Approves or declines a request (admin key). Approving one that's already
 * approved (another admin, a second click, auto-approval) counts as done.
 */
export async function decideRequest(srv: JfServerTarget, id: string, decision: 'approve' | 'decline') {
  if (!/^[0-9]{1,30}$/.test(id)) throw new UpstreamError('Unknown request', 400, 'seerr');
  try {
    await post(srv, `/admin/requests/${id}/${decision}`, {});
  } catch (err) {
    if (!(err instanceof UpstreamError) || err.status !== 409) throw err;
    // Silo answers 409 when the request has already moved on: see where it is now.
    const now = (await silo<Page<SiloRequest>>(srv, '/admin/requests', { limit: 50 }).catch(() => undefined))?.items?.find((r) => r.id === id);
    const done = decision === 'approve' ? now && now.state !== 'pending' && now.outcome === 'active' : now && (now.state === 'declined' || now.state === 'cancelled');
    if (!done) throw new UpstreamError(now ? `This request is already ${now.state.replace('_', ' ')}.` : 'This request has already been handled.', 409, 'seerr');
  } finally {
    // Title pages cache each title's request state too.
    cache.delete(`silo:${srv.id}:requests:`);
    cache.delete(`silo:${srv.id}:reqdetail:`);
  }
}

interface SiloRequestDetail {
  media_type: 'movie' | 'series';
  tmdb_id: number;
  tvdb_id?: number;
  imdb_id?: string;
  title: string;
  tagline?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  vote_average?: number;
  status?: string;
  genres?: string[];
  networks?: string[];
  production_companies?: string[];
  cast?: { name: string; character?: string; profile_path?: string }[];
  availability?: string;
  request?: { request_id?: string; status?: string; state?: string; requestable?: boolean };
  seasons?: { season_number: number; name?: string; episode_count?: number; air_date?: string; availability?: string; requested?: boolean }[];
}

/** Seerr's numeric media statuses (2 pending, 3 processing, 4 partial, 5 available). */
const MEDIA_NUM: Record<string, number> = { available: 5, partially_available: 4, partial: 4, processing: 3, downloading: 3, requested: 2, pending: 2 };
const REQUEST_NUM: Record<string, number> = { pending: 1, declined: 3, cancelled: 3, failed: 4 };

/**
 * A title's TMDb details and request state from Silo, in the shape title pages
 * read from Seerr (so they work the same either way).
 */
export async function titleDetail(srv: JfServerTarget, type: 'movie' | 'tv', tmdbId: number) {
  return cache.get(`silo:${srv.id}:reqdetail:${type}:${tmdbId}`, 15_000, async () => {
    const profile = await profileId(srv);
    const d = await silo<SiloRequestDetail>(srv, `/requests/detail/${type === 'tv' ? 'series' : 'movie'}/${tmdbId}`, undefined, profile);
    // The request itself, for who asked and which seasons.
    const req = d.request?.request_id ? (await listRequests(srv, { limit: 50 })).find((r) => r.id === d.request!.request_id) : undefined;
    const state = d.request?.state;
    return {
      id: d.tmdb_id,
      title: type === 'movie' ? d.title : undefined,
      name: type === 'tv' ? d.title : undefined,
      tagline: d.tagline,
      overview: d.overview,
      releaseDate: type === 'movie' ? d.release_date : undefined,
      firstAirDate: type === 'tv' ? (d.first_air_date ?? d.release_date) : undefined,
      runtime: d.runtime,
      voteAverage: d.vote_average,
      genres: (d.genres ?? []).map((name) => ({ name })),
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      status: d.status,
      networks: (d.networks ?? []).map((name) => ({ name })),
      productionCompanies: (d.production_companies ?? []).map((name) => ({ name })),
      credits: { cast: (d.cast ?? []).map((c) => ({ name: c.name, character: c.character, profilePath: c.profile_path })) },
      externalIds: { tvdbId: d.tvdb_id, imdbId: d.imdb_id },
      seasons: (d.seasons ?? []).map((x) => ({ seasonNumber: x.season_number, episodeCount: x.episode_count, name: x.name, airDate: x.air_date })),
      mediaInfo: {
        status: MEDIA_NUM[d.availability ?? ''] ?? (state ? (MEDIA_NUM[state] ?? 2) : undefined),
        seasons: (d.seasons ?? []).filter((x) => x.availability && MEDIA_NUM[x.availability]).map((x) => ({ seasonNumber: x.season_number, status: MEDIA_NUM[x.availability!]! })),
        requests: d.request?.request_id
          ? [
              {
                id: d.request.request_id,
                status: REQUEST_NUM[state ?? ''] ?? 2,
                createdAt: req?.createdAt ?? new Date().toISOString(),
                is4k: false,
                requestedBy: { displayName: req?.requestedBy },
                seasons: (req?.seasons ?? (d.seasons ?? []).filter((x) => x.requested).map((x) => x.season_number)).map((seasonNumber) => ({ seasonNumber })),
              },
            ]
          : [],
      },
    };
  }).catch(() => undefined);
}

/** Titles to request (TMDb search through Silo), for search's Discover section. */
export async function searchRequestable(srv: JfServerTarget, q: string, limit = 12) {
  const profile = await profileId(srv);
  type Result = { media_type: 'movie' | 'series'; tmdb_id: number; title: string; year?: number; poster_path?: string; overview?: string; availability?: string; request?: { requestable?: boolean; state?: string; status?: string } };
  const res = await silo<{ results?: Result[] }>(srv, '/requests/search', { q }, profile);
  return (res.results ?? []).slice(0, limit).map((r) => {
    const type = r.media_type === 'series' ? ('tv' as const) : ('movie' as const);
    const avail = r.availability ?? '';
    const state = r.request?.state ?? r.request?.status;
    const status =
      avail === 'available' ? 'available' : avail === 'partially_available' || avail === 'partial' ? 'partial' : state === 'pending' ? 'requested' : state === 'approved' || state === 'processing' ? 'processing' : 'none';
    return {
      key: `silo-req:${type}:${r.tmdb_id}`,
      source: 'silo' as const,
      title: r.title,
      subtitle: type === 'tv' ? 'Series' : 'Movie',
      year: r.year,
      image: r.poster_path ? `${TMDB_IMG}/w185${r.poster_path}` : undefined,
      mediaType: type,
      tmdbId: r.tmdb_id,
      path: `/media/${type}/${r.tmdb_id}`,
      status: status as 'available' | 'partial' | 'requested' | 'processing' | 'none',
      overview: r.overview?.slice(0, 240),
    };
  });
}

/** A person's Silo session, kept server-side, for acting in their own name. */
export interface SiloUserSession {
  accessToken: string;
  refreshToken?: string;
}

/** Calls Silo as a person, refreshing their access token once if it has expired. */
async function asUser<T>(srv: JfServerTarget, who: SiloUserSession, onRefresh: (s: SiloUserSession) => void, path: string, init: { method?: string; body?: unknown; profile?: string } = {}) {
  const call = (token: string) =>
    requestJson<T>(buildUrl(base(srv.url), `/api/v2${path}`), {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init.profile ? { 'X-Profile-Id': init.profile } : {}) },
      body: init.body,
      service: 'jellyfin',
    });
  try {
    return await call(who.accessToken);
  } catch (err) {
    if (!(err instanceof UpstreamError) || err.status !== 401 || !who.refreshToken) throw err;
    const fresh = await requestJson<{ access_token: string; refresh_token?: string }>(buildUrl(base(srv.url), '/api/v2/auth/refresh'), {
      method: 'POST',
      body: { refresh_token: who.refreshToken },
      service: 'jellyfin',
    });
    const next = { accessToken: fresh.access_token, refreshToken: fresh.refresh_token ?? who.refreshToken };
    onRefresh(next);
    return call(next.accessToken);
  }
}

/**
 * Requests a movie or series in the person's own name (their Silo session),
 * for every season not already in the library or requested.
 */
export async function createRequest(srv: JfServerTarget, who: SiloUserSession, onRefresh: (s: SiloUserSession) => void, type: 'movie' | 'tv', tmdbId: number) {
  const profiles = await asUser<{ items?: { id: string; is_primary?: boolean; requests_allowed?: boolean }[] }>(srv, who, onRefresh, '/profiles');
  const profile = profiles.items?.find((p) => p.is_primary) ?? profiles.items?.[0];
  if (!profile) throw new UpstreamError('Your Silo account has no profile to request with', 400, 'seerr');
  if (profile.requests_allowed === false) throw new UpstreamError('Your Silo profile isn’t allowed to make requests', 403, 'seerr');
  const d = await asUser<SiloRequestDetail>(srv, who, onRefresh, `/requests/detail/${type === 'tv' ? 'series' : 'movie'}/${tmdbId}`, { profile: profile.id });
  if (d.request && d.request.requestable === false) throw new UpstreamError('This is already requested or in the library', 409, 'seerr');
  const body: Record<string, unknown> = {
    media_type: type === 'tv' ? 'series' : 'movie',
    tmdb_id: d.tmdb_id,
    title: d.title,
    year: (d.release_date ?? d.first_air_date)?.slice(0, 4) ? Number((d.release_date ?? d.first_air_date)!.slice(0, 4)) : undefined,
    imdb_id: d.imdb_id,
    tvdb_id: d.tvdb_id,
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    overview: d.overview,
  };
  if (type === 'tv') {
    const seasons = (d.seasons ?? []).filter((x) => x.season_number > 0 && !x.requested && x.availability !== 'available').map((x) => x.season_number);
    if (!seasons.length) throw new UpstreamError('Every season is already available or requested', 409, 'seerr');
    body.seasons = seasons;
  }
  const r = await asUser<SiloRequest>(srv, who, onRefresh, '/requests', { method: 'POST', body, profile: profile.id });
  cache.delete(`silo:${srv.id}:requests:`);
  cache.delete(`silo:${srv.id}:reqdetail:`);
  return { id: r.id, state: r.state };
}

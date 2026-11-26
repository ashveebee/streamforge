import { buildUrl, requestJson, requestRaw, UpstreamError } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import { VERSION } from '../version.js';
import type { ArtworkRef, JfServerTarget, NowPlaying } from './jellyfin.js';
import type { HealthProbe } from './types.js';

/*
 * Plex Media Server, monitored as an extra media server with an
 * X-Plex-Token. Everything here returns the same shapes as the Jellyfin
 * functions for extra servers, so the UI treats every server the same way.
 *
 * Artwork refs point at Plex metadata: `itemId` is the rating key, `type`
 * Primary (thumb) or Backdrop (art), and `tag` the image's timestamp.
 */

const CLIENT_ID = 'streamforge-server';

function headers(token: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': CLIENT_ID,
    'X-Plex-Product': 'StreamForge',
    'X-Plex-Version': VERSION,
    'X-Plex-Device-Name': 'StreamForge Dashboard',
  };
}

const base = (url: string) => url.replace(/\/+$/, '');

function plex<T>(srv: Pick<JfServerTarget, 'url' | 'apiKey'>, path: string, query?: Record<string, string | number | boolean | undefined>) {
  return requestJson<T>(buildUrl(base(srv.url), path, query), { headers: headers(srv.apiKey), service: 'jellyfin' });
}

/* --------------------------------- types --------------------------------- */

interface PlexStream {
  streamType: number; // 1 video, 2 audio, 3 subtitle
  codec?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  bitDepth?: number;
  frameRate?: number;
  channels?: number;
  displayTitle?: string;
  selected?: boolean;
  default?: boolean;
  colorTrc?: string;
  DOVIPresent?: boolean;
}

interface PlexMedia {
  container?: string;
  bitrate?: number; // kbps
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  Part?: { Stream?: PlexStream[]; decision?: string }[];
}

interface PlexMetadata {
  ratingKey: string;
  type: string;
  title: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  summary?: string;
  contentRating?: string;
  rating?: number;
  audienceRating?: number;
  duration?: number;
  viewOffset?: number;
  addedAt?: number;
  thumb?: string;
  art?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  grandparentArt?: string;
  Genre?: { tag: string }[];
  Media?: PlexMedia[];
  User?: { id?: string; title?: string; thumb?: string };
  Player?: { title?: string; product?: string; platform?: string; version?: string; address?: string; machineIdentifier?: string; state?: string; local?: boolean };
  Session?: { id?: string; bandwidth?: number; location?: string };
  TranscodeSession?: {
    videoDecision?: string;
    audioDecision?: string;
    videoCodec?: string;
    audioCodec?: string;
    container?: string;
    width?: number;
    height?: number;
    progress?: number;
    transcodeHwRequested?: boolean;
    transcodeHwFullPipeline?: boolean;
    transcodeHwEncoding?: string;
    transcodeHwDecoding?: string;
  };
}

interface Container<T> {
  MediaContainer: T;
}

interface PlexIdentity {
  friendlyName?: string;
  version?: string;
  platform?: string;
  platformVersion?: string;
  machineIdentifier?: string;
}

/* --------------------------------- health -------------------------------- */

/** Checks a Plex server. `/identity` needs no token; `/` confirms the token works. */
export async function probe(target: { url: string; apiKey?: string }): Promise<HealthProbe> {
  const ident = await requestJson<Container<PlexIdentity>>(buildUrl(base(target.url), '/identity'), {
    headers: { Accept: 'application/json' },
    service: 'jellyfin',
  }).catch((err) => {
    throw err instanceof UpstreamError && err.status === 404 ? new UpstreamError('This does not look like a Plex server', 404, 'jellyfin') : err;
  });
  if (!ident?.MediaContainer?.machineIdentifier) throw new UpstreamError('This does not look like a Plex server', undefined, 'jellyfin');
  const result: HealthProbe = { version: ident.MediaContainer.version, issues: [] };
  if (target.apiKey) {
    const root = await plex<Container<PlexIdentity & { updatedAt?: number }>>({ url: target.url, apiKey: target.apiKey }, '/');
    result.meta = { server: root.MediaContainer.friendlyName, os: root.MediaContainer.platform };
  }
  return result;
}

/** The server's own id (machineIdentifier); needs no token. */
export async function identity(url: string) {
  const ident = await requestJson<Container<PlexIdentity>>(buildUrl(base(url), '/identity'), { headers: { Accept: 'application/json' }, service: 'jellyfin' }).catch(() => undefined);
  return ident?.MediaContainer?.machineIdentifier;
}

/* ------------------------------- now playing ------------------------------ */

const TYPE: Record<string, string> = { movie: 'Movie', episode: 'Episode', track: 'Audio', clip: 'Video', season: 'Season', show: 'Series', album: 'MusicAlbum' };

/** Turns a Plex image path into an artwork ref the image proxy understands. */
function art(path: string | undefined, server: string): ArtworkRef | undefined {
  const m = path?.match(/^\/library\/metadata\/(\d{1,12})\/(thumb|art)\/(\d{1,12})$/);
  if (!m) return undefined;
  return { itemId: m[1]!, type: m[2] === 'art' ? 'Backdrop' : 'Primary', tag: m[3], server };
}

function artworkFor(m: PlexMetadata, server: string) {
  const ep = m.type === 'episode';
  return {
    poster: art(ep ? m.grandparentThumb : m.type === 'track' ? (m.parentThumb ?? m.thumb) : m.thumb, server),
    backdrop: art(ep ? (m.grandparentArt ?? m.art) : m.art, server),
    logo: undefined as ArtworkRef | undefined,
    thumb: ep ? art(m.thumb, server) : undefined,
  };
}

function resolutionLabel(w?: number, h?: number, plexLabel?: string) {
  if (w && h) {
    if (w >= 3800 || h >= 2100) return '4K';
    if (w >= 2500 || h >= 1400) return '1440p';
    if (w >= 1900 || h >= 1000) return '1080p';
    if (w >= 1260 || h >= 700) return '720p';
    if (h >= 560) return '576p';
    return `${h}p`;
  }
  if (!plexLabel) return undefined;
  return plexLabel === '4k' ? '4K' : /^\d+$/.test(plexLabel) ? `${plexLabel}p` : plexLabel.toUpperCase();
}

function rangeOf(v?: PlexStream) {
  if (!v) return undefined;
  if (v.DOVIPresent) return 'DOVI';
  if (v.colorTrc === 'smpte2084') return 'HDR10';
  if (v.colorTrc === 'arib-std-b67') return 'HLG';
  return 'SDR';
}

function normalise(m: PlexMetadata, srv: JfServerTarget): NowPlaying {
  const media = m.Media?.[0];
  const streams = media?.Part?.[0]?.Stream ?? [];
  const video = streams.find((s) => s.streamType === 1);
  const audio = streams.find((s) => s.streamType === 2 && s.selected) ?? streams.find((s) => s.streamType === 2);
  const sub = streams.find((s) => s.streamType === 3 && s.selected);
  const t = m.TranscodeSession;
  const runtimeMs = m.duration ?? 0;
  const positionMs = m.viewOffset ?? 0;
  const videoTranscode = t?.videoDecision === 'transcode';
  const audioTranscode = t?.audioDecision === 'transcode';
  const playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode' = videoTranscode || audioTranscode ? 'Transcode' : t ? 'DirectStream' : 'DirectPlay';
  const range = rangeOf(video);
  const hw = t?.transcodeHwEncoding || t?.transcodeHwDecoding || (t?.transcodeHwFullPipeline ? 'hardware' : undefined);

  if (m.User?.id && m.User.thumb) rememberAvatar(m.User.id, m.User.thumb);
  return {
    sessionId: m.Session?.id ?? m.ratingKey,
    user: { id: m.User?.id, name: m.User?.title ?? 'Unknown user', imageTag: m.User?.thumb ? 'plex' : undefined },
    client: m.Player?.product,
    device: m.Player?.title ?? m.Player?.platform,
    deviceId: m.Player?.machineIdentifier,
    appVersion: m.Player?.version,
    remoteAddress: m.Player?.address,
    lastActivity: undefined,
    item: {
      id: m.ratingKey,
      type: TYPE[m.type] ?? 'Video',
      mediaType: m.type === 'track' ? 'Audio' : 'Video',
      title: m.title,
      seriesName: m.type === 'episode' ? m.grandparentTitle : undefined,
      seasonNumber: m.type === 'episode' ? m.parentIndex : undefined,
      episodeNumber: m.type === 'episode' ? m.index : undefined,
      album: m.type === 'track' ? m.parentTitle : undefined,
      artist: m.type === 'track' ? m.grandparentTitle : undefined,
      year: m.year,
      overview: m.summary,
      genres: m.Genre?.slice(0, 3).map((g) => g.tag) ?? [],
      officialRating: m.contentRating,
      communityRating: m.audienceRating ?? m.rating,
      runtimeMs,
      resolution: resolutionLabel(video?.width, video?.height, media?.videoResolution),
      hdr: range && range !== 'SDR' ? range : undefined,
      videoCodec: video?.codec ?? media?.videoCodec,
      bitrate: video?.bitrate ? video.bitrate * 1000 : undefined,
      frameRate: video?.frameRate,
      audio: audio?.displayTitle ?? audio?.codec ?? media?.audioCodec,
      ...artworkFor(m, srv.id),
    },
    media: {
      container: media?.container,
      bitrate: media?.bitrate ? media.bitrate * 1000 : undefined,
      video: video && { codec: video.codec, range, bitDepth: video.bitDepth, width: video.width, height: video.height },
      audio: audio && { codec: audio.codec, channels: audio.channels },
      subtitle: sub && { codec: sub.codec },
    },
    state: {
      positionMs,
      progress: runtimeMs > 0 ? Math.min(1, positionMs / runtimeMs) : 0,
      isPaused: m.Player?.state === 'paused',
      isMuted: false,
      playMethod,
    },
    transcode: t
      ? {
          videoCodec: t.videoCodec,
          audioCodec: t.audioCodec,
          container: t.container,
          bitrate: m.Session?.bandwidth ? m.Session.bandwidth * 1000 : undefined,
          resolution: resolutionLabel(t.width, t.height),
          framerate: undefined,
          isVideoDirect: !videoTranscode,
          isAudioDirect: !audioTranscode,
          completion: t.progress,
          hwAccel: hw,
          reasons: [],
        }
      : undefined,
  };
}

async function sessions(srv: JfServerTarget) {
  const res = await cache.get(`plex:${srv.id}:sessions`, 2_000, () => plex<Container<{ size?: number; Metadata?: PlexMetadata[] }>>(srv, '/status/sessions'));
  return res.MediaContainer.Metadata ?? [];
}

/** Active streams, tagged with the server they're playing on. */
export async function nowPlaying(srv: JfServerTarget) {
  return (await sessions(srv)).map((m) => ({ ...normalise(m, srv), server: srv.id, serverName: srv.name, serverType: 'plex' as const }));
}

/* -------------------------------- overview -------------------------------- */

interface PlexSection {
  key: string;
  title: string;
  type: 'movie' | 'show' | 'artist' | 'photo' | string;
  refreshing?: boolean;
  Location?: { path: string }[];
}

const SECTION_TYPE: Record<string, string> = { movie: 'movies', show: 'tvshows', artist: 'music', photo: 'photos' };
// Plex metadata type numbers: 1 movie, 2 show, 4 episode, 8 artist, 9 album, 10 track.
const MAIN_TYPE: Record<string, number> = { movie: 1, show: 2, artist: 8 };

async function countOf(srv: JfServerTarget, section: string, type?: number) {
  const res = await plex<Container<{ totalSize?: number; size?: number }>>(srv, `/library/sections/${section}/all`, {
    type,
    'X-Plex-Container-Start': 0,
    'X-Plex-Container-Size': 0,
  }).catch(() => undefined);
  return res?.MediaContainer.totalSize ?? res?.MediaContainer.size;
}

interface PlexAccount {
  id: number;
  name?: string;
  thumb?: string;
}

interface PlexHistory {
  historyKey?: string;
  ratingKey?: string;
  title?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  type?: string;
  viewedAt?: number;
  accountID?: number;
  /** Episodes: the show's key, `/library/metadata/<id>`. */
  grandparentKey?: string;
}

const accounts = (srv: JfServerTarget) =>
  cache.get(`plex:${srv.id}:accounts`, 5 * 60_000, async () => {
    const res = await plex<Container<{ Account?: PlexAccount[] }>>(srv, '/accounts').catch(() => undefined);
    // Account 0 is a placeholder for local, signed-out playback.
    const list = (res?.MediaContainer.Account ?? []).filter((a) => a.id > 0 && a.name);
    for (const a of list) if (a.thumb) rememberAvatar(String(a.id), a.thumb);
    return list;
  });

const history = (srv: JfServerTarget, limit: number) =>
  cache.get(`plex:${srv.id}:history:${limit}`, 15_000, async () => {
    const res = await plex<Container<{ Metadata?: PlexHistory[] }>>(srv, '/status/sessions/history/all', {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': limit,
    });
    return res.MediaContainer.Metadata ?? [];
  });

/** The same shape as `jellyfin.remoteOverview`. */
export async function overview(srv: JfServerTarget) {
  const p = `plex:${srv.id}:`;
  const [root, libs, users, sessionList, recent] = await Promise.all([
    cache.get(`${p}root`, 30_000, () => plex<Container<PlexIdentity>>(srv, '/')),
    cache.get(`${p}libraries`, 5 * 60_000, async () => {
      const res = await plex<Container<{ Directory?: PlexSection[] }>>(srv, '/library/sections');
      return Promise.all(
        (res.MediaContainer.Directory ?? []).map(async (d) => ({
          section: d,
          count: await countOf(srv, d.key, MAIN_TYPE[d.type]),
          episodes: d.type === 'show' ? await countOf(srv, d.key, 4) : undefined,
          albums: d.type === 'artist' ? await countOf(srv, d.key, 9) : undefined,
          tracks: d.type === 'artist' ? await countOf(srv, d.key, 10) : undefined,
        })),
      );
    }),
    accounts(srv),
    sessions(srv),
    history(srv, 200).catch(() => [] as PlexHistory[]),
  ]);

  const sum = (pick: (l: (typeof libs)[number]) => number | undefined, type?: string) =>
    libs.filter((l) => !type || l.section.type === type).reduce((n, l) => n + (pick(l) ?? 0), 0);
  // Plex has no "last active" per account; take it from play history.
  const lastSeen = new Map<number, number>();
  for (const h of recent) if (h.accountID && h.viewedAt && !lastSeen.has(h.accountID)) lastSeen.set(h.accountID, h.viewedAt * 1000);
  const dayAgo = Date.now() - 86_400_000;
  const playing = new Set(sessionList.map((s) => s.User?.id).filter(Boolean));
  const isTranscode = (s: PlexMetadata) => s.TranscodeSession?.videoDecision === 'transcode' || s.TranscodeSession?.audioDecision === 'transcode';
  const info = root.MediaContainer;

  return {
    server: {
      id: srv.id,
      name: info.friendlyName ?? srv.name,
      version: info.version ?? '',
      os: [info.platform, info.platformVersion].filter(Boolean).join(' ') || undefined,
      architecture: undefined as string | undefined,
      hasUpdateAvailable: false,
      hasPendingRestart: false,
    },
    counts: {
      movies: sum((l) => l.count, 'movie'),
      series: sum((l) => l.count, 'show'),
      episodes: sum((l) => l.episodes),
      albums: sum((l) => l.albums),
      songs: sum((l) => l.tracks),
      artists: sum((l) => l.count, 'artist'),
      books: 0,
      musicVideos: 0,
      collections: 0,
    },
    libraries: libs.map(({ section: d, count }) => ({
      id: d.key,
      name: d.title,
      type: SECTION_TYPE[d.type] ?? 'mixed',
      locations: d.Location?.map((l) => l.path) ?? [],
      itemCount: count,
      refreshing: !!d.refreshing,
      refreshProgress: undefined as number | undefined,
      image: undefined as ArtworkRef | undefined,
    })),
    users: {
      total: users.length,
      active24h: users.filter((u) => (lastSeen.get(u.id) ?? 0) > dayAgo || playing.has(String(u.id))).length,
      list: users
        .map((u) => {
          const seen = lastSeen.get(u.id);
          return { id: String(u.id), name: u.name!, imageTag: u.thumb ? 'plex' : undefined, isAdmin: u.id === 1, lastActivity: seen ? new Date(seen).toISOString() : undefined };
        })
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

/** Newest movies, episodes and albums. */
export async function latest(srv: JfServerTarget, limit = 20) {
  return cache.get(`plex:${srv.id}:latest:${limit}`, 60_000, async () => {
    const res = await plex<Container<{ Metadata?: PlexMetadata[] }>>(srv, '/library/recentlyAdded', {
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': limit,
    });
    return (res.MediaContainer.Metadata ?? []).slice(0, limit).map((m) => {
      const a = artworkFor(m, srv.id);
      const season = m.type === 'season';
      return {
        id: m.ratingKey,
        type: TYPE[m.type] ?? m.type,
        title: m.type === 'episode' ? (m.grandparentTitle ?? m.title) : season ? (m.parentTitle ?? m.title) : m.title,
        subtitle:
          m.type === 'episode'
            ? `S${m.parentIndex ?? 0}·E${m.index ?? 0} — ${m.title}`
            : season
              ? m.title
              : m.type === 'album'
                ? m.parentTitle
                : undefined,
        year: m.year,
        added: m.addedAt ? new Date(m.addedAt * 1000).toISOString() : undefined,
        rating: m.audienceRating ?? m.rating,
        ...a,
        // Seasons carry the show's poster as parentThumb.
        poster: a.poster ?? art(m.parentThumb, srv.id),
      };
    });
  });
}

/** Plex has no activity log; recent plays from its watch history stand in for one. */
export async function activity(srv: JfServerTarget, limit = 25) {
  const [items, users] = await Promise.all([history(srv, limit), accounts(srv)]);
  const names = new Map(users.map((u) => [u.id, u.name!]));
  return items.map((h, i) => {
    const what =
      h.type === 'episode' && h.grandparentTitle
        ? `${h.grandparentTitle} S${h.parentIndex ?? 0}·E${h.index ?? 0}`
        : (h.title ?? 'something');
    const who = (h.accountID && names.get(h.accountID)) || 'Someone';
    return {
      id: h.historyKey ?? `${h.ratingKey}-${h.viewedAt}-${i}`,
      name: `${who} watched ${what}`,
      overview: h.type === 'episode' ? h.title : undefined,
      type: h.type === 'track' ? 'AudioPlayback' : 'VideoPlayback',
      date: h.viewedAt ? new Date(h.viewedAt * 1000).toISOString() : new Date().toISOString(),
      severity: 'Information',
      userId: h.accountID ? String(h.accountID) : undefined,
    };
  });
}

/* ------------------------------ images, control ----------------------------- */

export function isValidId(id: string) {
  return /^\d{1,12}$/.test(id);
}

/** Artwork via Plex's photo transcoder, resized on the server. */
export function image(srv: JfServerTarget, id: string, type: string, opts: { tag?: string; maxWidth?: number }) {
  if (!opts.tag || !/^\d{1,12}$/.test(opts.tag)) return Promise.resolve(new Response(null, { status: 404 }));
  const path = `/library/metadata/${id}/${type === 'Backdrop' ? 'art' : 'thumb'}/${opts.tag}`;
  const width = opts.maxWidth ?? 600;
  return requestRaw(
    buildUrl(base(srv.url), '/photo/:/transcode', { url: path, width, height: width * 2, minSize: 1, upscale: 0 }),
    { headers: { ...headers(srv.apiKey), Accept: 'image/*' }, service: 'jellyfin' },
  );
}

/**
 * Stops a stream, showing `reason` to the viewer. Plex only lets the server
 * end streams (a Plex Pass feature); pausing and messages aren't possible.
 */
export async function stopSession(srv: JfServerTarget, sessionId: string, reason?: string) {
  await plex(srv, '/status/sessions/terminate', { sessionId, reason: reason || 'Stopped by the server admin' });
  cache.delete(`plex:${srv.id}:sessions`);
}

/* ------------------------------- avatars ------------------------------- */

/*
 * Plex avatars live on plex.tv. We remember each account's avatar address as
 * we see it (sessions, the account list, sign-in) and proxy it, so the browser
 * never talks to plex.tv and only plex.tv addresses are ever fetched.
 */
const avatars = new Map<string, string>();

export function rememberAvatar(userId: string, url: string) {
  if (isPlexTvUrl(url)) avatars.set(userId, url);
}

function isPlexTvUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'plex.tv' || u.hostname.endsWith('.plex.tv'));
  } catch {
    return false;
  }
}

export function avatar(userId: string, fallback?: string) {
  const url = avatars.get(userId) ?? (fallback && isPlexTvUrl(fallback) ? fallback : undefined);
  if (!url) return Promise.resolve(new Response(null, { status: 404 }));
  return requestRaw(url, { headers: { Accept: 'image/*' }, service: 'jellyfin' });
}

/* --------------------------- library and history --------------------------- */

interface PlexLibraryItem {
  ratingKey: string;
  title: string;
  type: string;
  year?: number;
  viewCount?: number;
  lastViewedAt?: number;
  Guid?: { id: string }[];
}

/** Movies and shows with their TMDB/TVDB/IMDb ids, like `jellyfin.libraryItems`. */
export async function libraryItems(srv: JfServerTarget) {
  return cache.get(`plex:${srv.id}:libitems`, 10 * 60_000, async () => {
    const res = await plex<Container<{ Directory?: PlexSection[] }>>(srv, '/library/sections');
    const sections = (res.MediaContainer.Directory ?? []).filter((d) => d.type === 'movie' || d.type === 'show');
    const [lists, watched] = await Promise.all([
      Promise.all(
        sections.map((d) =>
          plex<Container<{ Metadata?: PlexLibraryItem[] }>>(srv, `/library/sections/${d.key}/all`, { includeGuids: 1 })
            .then((r) => r.MediaContainer.Metadata ?? [])
            .catch(() => [] as PlexLibraryItem[]),
        ),
      ),
      lastWatchedByAnyone(srv).catch(() => new Map<string, number>()),
    ]);
    return lists.flat().map((i) => {
      const id = (scheme: string) => i.Guid?.find((g) => g.id.startsWith(`${scheme}://`))?.id.slice(scheme.length + 3);
      return {
        id: i.ratingKey,
        name: i.title,
        type: (i.type === 'show' ? 'Series' : 'Movie') as 'Series' | 'Movie',
        year: i.year,
        tvdb: id('tvdb'),
        tmdb: id('tmdb'),
        imdb: id('imdb'),
        // lastViewedAt is only the owner's viewing; the watch history covers every account.
        lastPlayed: Math.max(i.lastViewedAt ? i.lastViewedAt * 1000 : 0, watched.get(i.ratingKey) ?? 0) || undefined,
      };
    });
  });
}

/** Movie or show id → the last time any account watched it, from the server's watch history. */
async function lastWatchedByAnyone(srv: JfServerTarget) {
  const items = await cache.get(`plex:${srv.id}:history:big`, 5 * 60_000, async () => {
    const res = await plex<Container<{ Metadata?: PlexHistory[] }>>(srv, '/status/sessions/history/all', {
      sort: 'viewedAt:desc',
      'X-Plex-Container-Start': 0,
      'X-Plex-Container-Size': 5000,
    });
    return res.MediaContainer.Metadata ?? [];
  });
  const out = new Map<string, number>();
  for (const h of items) {
    if (!h.viewedAt) continue;
    const show = h.type === 'episode' ? h.grandparentKey?.match(/\/library\/metadata\/(\d+)/)?.[1] : undefined;
    const key = show ?? h.ratingKey;
    if (key && h.viewedAt * 1000 > (out.get(key) ?? 0)) out.set(key, h.viewedAt * 1000);
  }
  return out;
}

/** Plays from Plex's watch history since a time, for stats (no watch time or transcode data). */
export async function playsSince(srv: JfServerTarget, since: number) {
  const [items, users] = await Promise.all([
    cache.get(`plex:${srv.id}:history:big`, 5 * 60_000, async () => {
      const res = await plex<Container<{ Metadata?: PlexHistory[] }>>(srv, '/status/sessions/history/all', {
        sort: 'viewedAt:desc',
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': 5000,
      });
      return res.MediaContainer.Metadata ?? [];
    }),
    accounts(srv),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name!]));
  return items
    .filter((h) => h.viewedAt && h.viewedAt * 1000 >= since)
    .map((h) => {
      const title = h.type === 'episode' && h.grandparentTitle ? `${h.grandparentTitle} - S${String(h.parentIndex ?? 0).padStart(2, '0')}E${String(h.index ?? 0).padStart(2, '0')} - ${h.title}` : (h.title ?? 'Unknown');
      return {
        user: (h.accountID && names.get(h.accountID)) || 'Someone',
        userId: h.accountID ? String(h.accountID) : undefined,
        title,
        group: h.type === 'episode' ? (h.grandparentTitle ?? title) : title,
        at: h.viewedAt! * 1000,
      };
    });
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

/* ------------------------------ your page ------------------------------ */

/**
 * A user's On Deck: what they're part-way through and the next episodes.
 * Uses that user's own server token, so it's their progress, not the owner's.
 */
export async function onDeck(srv: JfServerTarget, userId: string, userToken?: string) {
  const target = { ...srv, apiKey: userToken || srv.apiKey };
  const res = await cache.get(`plex:${srv.id}:deck:${userId}`, 30_000, () =>
    plex<Container<{ Metadata?: PlexMetadata[] }>>(target, '/library/onDeck', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 24 }),
  );
  const cards = (res.MediaContainer.Metadata ?? []).map((m) => {
    const a = artworkFor(m, srv.id);
    const ep = m.type === 'episode' ? `S${String(m.parentIndex ?? 0).padStart(2, '0')}E${String(m.index ?? 0).padStart(2, '0')}` : undefined;
    const runtime = m.duration;
    const position = m.viewOffset;
    return {
      inProgress: !!position,
      card: {
        id: m.ratingKey,
        title: m.type === 'episode' ? (m.grandparentTitle ?? m.title) : m.title,
        subtitle: m.type === 'episode' ? [ep, m.title].filter(Boolean).join(' · ') : m.year ? String(m.year) : undefined,
        progress: runtime && position ? position / runtime : undefined,
        remainingMs: runtime && position ? Math.max(0, runtime - position) : undefined,
        lastPlayed: undefined as string | undefined,
        image: a.backdrop ?? a.thumb ?? a.poster,
      },
    };
  });
  return { resume: cards.filter((c) => c.inProgress).map((c) => c.card), nextUp: cards.filter((c) => !c.inProgress).map((c) => c.card) };
}

/* -------------------------------- search -------------------------------- */

const SEARCH_TYPES = new Set(['movie', 'show', 'episode', 'artist', 'album']);

/** Library search, in the same shape as the other search sources. */
export async function search(srv: JfServerTarget, q: string, limit = 12) {
  const res = await plex<Container<{ Hub?: { type: string; Metadata?: PlexMetadata[] }[] }>>(srv, '/hubs/search', { query: q, limit });
  const items = (res.MediaContainer.Hub ?? []).filter((h) => SEARCH_TYPES.has(h.type)).flatMap((h) => h.Metadata ?? []);
  return items.slice(0, limit).map((m) => {
    const a = artworkFor(m, srv.id);
    const kind = TYPE[m.type] ?? m.type;
    return {
      key: `plex:${srv.id}:${m.ratingKey}`,
      source: 'plex' as const,
      title: m.title,
      subtitle: [m.type === 'episode' ? m.grandparentTitle : m.type === 'album' ? m.parentTitle : undefined, kind === 'Series' ? 'Series' : kind].filter(Boolean).join(' · '),
      year: m.year,
      image: a.poster ? `/api/jellyfin/image/items/${a.poster.itemId}/Primary?w=120&tag=${a.poster.tag}&server=${encodeURIComponent(srv.id)}` : undefined,
      status: 'available' as const,
      path: `/plex?instance=${encodeURIComponent(srv.id)}`,
    };
  });
}

/* --------------------------------- scans -------------------------------- */

/** Scans one library (or all of them) for new files; `full` also refreshes metadata. */
export async function scan(srv: JfServerTarget, section?: string, full = false) {
  if (section && !/^\d{1,8}$/.test(section)) throw new UpstreamError('Unknown library', 400, 'jellyfin');
  await plex(srv, `/library/sections/${section ?? 'all'}/refresh`, full ? { force: 1 } : undefined);
  cache.delete(`plex:${srv.id}:libraries`);
}

/* -------------------------------- digest -------------------------------- */

/** What was added since a time, in the weekly digest's shape. */
export async function addedSince(srv: JfServerTarget, since: number) {
  const res = await plex<Container<{ Directory?: PlexSection[] }>>(srv, '/library/sections');
  const sections = res.MediaContainer.Directory ?? [];
  // Newest first per section: movies (1), episodes (4) and albums (9).
  const jobs = sections.flatMap((d) => {
    const type = d.type === 'movie' ? 1 : d.type === 'show' ? 4 : d.type === 'artist' ? 9 : undefined;
    if (!type) return [];
    return [
      plex<Container<{ Metadata?: PlexMetadata[] }>>(srv, `/library/sections/${d.key}/all`, {
        type,
        sort: 'addedAt:desc',
        'X-Plex-Container-Start': 0,
        'X-Plex-Container-Size': 300,
      })
        .then((r) => r.MediaContainer.Metadata ?? [])
        .catch(() => [] as PlexMetadata[]),
    ];
  });
  const items = (await Promise.all(jobs)).flat().filter((m) => (m.addedAt ?? 0) * 1000 >= since);
  const img = (path: string | undefined) => {
    const a = art(path, srv.id);
    return a ? `/api/jellyfin/image/items/${a.itemId}/Primary?w=200&tag=${a.tag}&server=${encodeURIComponent(srv.id)}` : undefined;
  };
  const movies: { id: string; title: string; year?: number; image?: string }[] = [];
  const shows = new Map<string, { id: string; title: string; episodes: number; image?: string }>();
  const other: { id: string; title: string; kind: string }[] = [];
  let runtimeMs = 0;
  for (const m of items) {
    runtimeMs += m.duration ?? 0;
    if (m.type === 'movie') movies.push({ id: m.ratingKey, title: m.title, year: m.year, image: img(m.thumb) });
    else if (m.type === 'episode') {
      const key = m.grandparentTitle ?? m.title;
      const s = shows.get(key) ?? { id: m.ratingKey, title: key, episodes: 0, image: img(m.grandparentThumb) };
      s.episodes++;
      shows.set(key, s);
    } else other.push({ id: m.ratingKey, title: m.parentTitle ? `${m.parentTitle} – ${m.title}` : m.title, kind: 'Album' });
  }
  return { movies, shows: [...shows.values()].sort((a, b) => b.episodes - a.episodes), other, runtimeMs };
}

/* ------------------------------ collections ------------------------------ */

/** Movie and TV libraries, for picking where a collection goes. */
export async function movieAndShowLibraries(srv: JfServerTarget) {
  const res = await plex<Container<{ Directory?: PlexSection[] }>>(srv, '/library/sections');
  return (res.MediaContainer.Directory ?? [])
    .filter((d) => d.type === 'movie' || d.type === 'show')
    .map((d) => ({ id: d.key, name: d.title, kind: (d.type === 'movie' ? 'movie' : 'show') as 'movie' | 'show' }));
}

interface PlexCollection {
  ratingKey: string;
  title: string;
  childCount?: number;
  thumb?: string;
  updatedAt?: number;
}

/** Collections in one library. */
export async function collections(srv: JfServerTarget, section: string) {
  const res = await plex<Container<{ Metadata?: PlexCollection[] }>>(srv, `/library/sections/${section}/collections`);
  return (res.MediaContainer.Metadata ?? []).map((c) => ({
    id: c.ratingKey,
    name: c.title,
    count: c.childCount ?? 0,
    poster: art(c.thumb?.replace(/\/composite\/.*/, ''), srv.id) ?? collectionArt(c, srv.id),
  }));
}

/** Collection posters live at /library/collections/<id>/thumb/<ts>; the proxy reads them as Primary. */
function collectionArt(c: PlexCollection, server: string): ArtworkRef | undefined {
  const m = c.thumb?.match(/^\/library\/(?:collections|metadata)\/(\d{1,12})\/thumb\/(\d{1,12})$/);
  return m ? { itemId: m[1]!, type: 'Primary', tag: m[2], server } : undefined;
}

/** The titles in a collection, with their TMDB/TVDB/IMDb ids. */
export async function collectionItems(srv: JfServerTarget, collectionId: string) {
  const res = await plex<Container<{ Metadata?: (PlexMetadata & { Guid?: { id: string }[] })[] }>>(srv, `/library/collections/${collectionId}/children`, { includeGuids: 1 });
  return (res.MediaContainer.Metadata ?? []).map((m) => {
    const id = (scheme: string) => m.Guid?.find((g) => g.id.startsWith(`${scheme}://`))?.id.slice(scheme.length + 3);
    return { id: m.ratingKey, title: m.title, year: m.year, tmdb: id('tmdb'), tvdb: id('tvdb'), poster: art(m.thumb, srv.id) };
  });
}

/* ------------------------------ title copies ------------------------------ */

interface PlexFileMedia extends Omit<PlexMedia, 'Part'> {
  id?: number | string;
  width?: number;
  height?: number;
  Part?: { id?: number | string; size?: number; file?: string; Stream?: (PlexStream & { language?: string; title?: string; forced?: boolean; key?: string; hearingImpaired?: boolean })[] }[];
}

const plexResolution = (w?: number, h?: number, label?: string) => {
  if (w && h) {
    if (w >= 3800 || h >= 2100) return '4K';
    if (w >= 2500 || h >= 1400) return '1440p';
    if (w >= 1900 || h >= 1000) return '1080p';
    if (w >= 1200 || h >= 700) return '720p';
    return `${h}p`;
  }
  return label ? (label === '4k' ? '4K' : /^\d+$/.test(label) ? `${label}p` : label.toUpperCase()) : undefined;
};
const plexChannels = (c?: number) => (c === 8 ? '7.1' : c === 6 ? '5.1' : c === 2 ? 'Stereo' : c === 1 ? 'Mono' : c ? `${c} ch` : undefined);

/**
 * A movie's copies on a Plex server, shaped like StreamForge's media info:
 * resolution, HDR, codecs, size and audio/subtitle tracks, plus when it was added.
 */
export async function itemFiles(srv: JfServerTarget, ratingKey: string, isAdmin: boolean) {
  if (!isValidId(ratingKey)) return { files: [], added: undefined };
  const res = await cache.get(`plex:${srv.id}:files:${ratingKey}`, 10 * 60_000, () =>
    plex<Container<{ Metadata?: (Omit<PlexMetadata, 'Media'> & { addedAt?: number; Media?: PlexFileMedia[] })[] }>>(srv, `/library/metadata/${ratingKey}`),
  );
  const m = res.MediaContainer.Metadata?.[0];
  const files = (m?.Media ?? []).map((media, i) => {
    const part = media.Part?.[0];
    const streams = part?.Stream ?? [];
    const v = streams.find((s) => s.streamType === 1);
    const dv = v?.DOVIPresent || /dolby vision|dovi/i.test(v?.displayTitle ?? '');
    const range = dv ? 'DOVI' : v?.colorTrc === 'smpte2084' || /hdr10/i.test(v?.displayTitle ?? '') ? 'HDR10' : v?.colorTrc === 'arib-std-b67' ? 'HLG' : undefined;
    return {
      id: String(media.id ?? `${ratingKey}-${i}`),
      name: undefined as string | undefined,
      container: media.container,
      size: part?.size,
      bitrate: media.bitrate ? media.bitrate * 1000 : undefined,
      path: isAdmin ? part?.file : undefined,
      video: v || media.videoResolution
        ? {
            codec: (v?.codec ?? media.videoCodec)?.toUpperCase(),
            resolution: plexResolution(v?.width ?? media.width, v?.height ?? media.height, media.videoResolution),
            width: v?.width ?? media.width,
            height: v?.height ?? media.height,
            range,
            bitDepth: v?.bitDepth,
            fps: v?.frameRate ? Math.round(v.frameRate * 100) / 100 : undefined,
            bitrate: v?.bitrate ? v.bitrate * 1000 : undefined,
          }
        : undefined,
      audio: streams
        .filter((s) => s.streamType === 2)
        .map((a) => ({ title: a.displayTitle ?? a.title, language: a.language, codec: a.codec?.toUpperCase(), channels: plexChannels(a.channels), isDefault: !!(a.default ?? a.selected) })),
      subtitles: streams
        .filter((s) => s.streamType === 3)
        .map((t) => ({ title: t.displayTitle ?? t.title, language: t.language, codec: t.codec?.toUpperCase(), forced: !!t.forced, external: !!t.key, sdh: !!t.hearingImpaired, isDefault: !!(t.default ?? t.selected) })),
    };
  });
  return { files, added: m?.addedAt ? new Date(m.addedAt * 1000).toISOString() : undefined };
}

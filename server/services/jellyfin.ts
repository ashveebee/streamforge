import { resolve } from '../settings.js';
import { buildUrl, requestJson, requestRaw, UpstreamError } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import { VERSION as APP_VERSION } from '../version.js';
import type { HealthProbe } from './types.js';

/** The configured Jellyfin URL; throws when Jellyfin hasn't been set up yet. */
function base() {
  const url = resolve('jellyfin').settings.url;
  if (!url) throw new UpstreamError('Jellyfin is not configured', undefined, 'jellyfin');
  return url;
}
const serverApiKey = () => resolve('jellyfin').settings.apiKey;
const CLIENT = 'StreamForge';
const VERSION = APP_VERSION;
const TICKS_PER_MS = 10_000;

export function authHeader(token?: string, deviceId = 'streamforge-server') {
  const parts = [
    `Client="${CLIENT}"`,
    `Device="StreamForge Dashboard"`,
    `DeviceId="${deviceId}"`,
    `Version="${VERSION}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return { Authorization: `MediaBrowser ${parts.join(', ')}` };
}

/** Context for a Jellyfin call: the signed-in user's token (and device). */
export interface JfCtx {
  token: string;
  deviceId: string;
  userId: string;
}

/**
 * Server-wide data (sessions, activity log, users) uses the optional
 * Jellyfin API key when present, otherwise the signed-in user's token.
 */
function serverToken(ctx: JfCtx) {
  return serverApiKey() ?? ctx.token;
}

function jf<T>(path: string, token: string, deviceId: string, query?: Record<string, string | number | boolean | undefined>) {
  return requestJson<T>(buildUrl(base(), path, query), {
    headers: authHeader(token, deviceId),
    service: 'jellyfin',
  });
}

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

interface JfUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  ServerId?: string;
  LastActivityDate?: string;
  LastLoginDate?: string;
  Policy?: { IsAdministrator?: boolean; IsDisabled?: boolean };
}

interface JfAuthResult {
  User: JfUser;
  AccessToken: string;
  ServerId: string;
}

export async function authenticate(username: string, password: string, deviceId: string) {
  try {
    return await requestJson<JfAuthResult>(buildUrl(base(), '/Users/AuthenticateByName'), {
      method: 'POST',
      headers: authHeader(undefined, deviceId),
      body: { Username: username, Pw: password },
      service: 'jellyfin',
    });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 401) {
      throw new UpstreamError('Invalid username or password', 401, 'jellyfin');
    }
    throw err;
  }
}

export async function currentUser(token: string, deviceId: string) {
  return jf<JfUser>('/Users/Me', token, deviceId);
}

export async function logout(token: string, deviceId: string) {
  await requestJson(buildUrl(base(), '/Sessions/Logout'), {
    method: 'POST',
    headers: authHeader(token, deviceId),
    service: 'jellyfin',
  }).catch(() => undefined);
}

interface JfPublicInfo {
  ServerName: string;
  Version: string;
  Id: string;
  ProductName?: string;
  StartupWizardCompleted?: boolean;
}

export function publicInfo() {
  return cache.get('jf:public', 60_000, () =>
    requestJson<JfPublicInfo>(buildUrl(base(), '/System/Info/Public'), { service: 'jellyfin' }),
  );
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

interface JfSystemInfo extends JfPublicInfo {
  OperatingSystemDisplayName?: string;
  OperatingSystem?: string;
  HasPendingRestart?: boolean;
  HasUpdateAvailable?: boolean;
  IsShuttingDown?: boolean;
  WebSocketPortNumber?: number;
  SystemArchitecture?: string;
  CanSelfRestart?: boolean;
}

/** Checks Jellyfin. Pass `target` to test candidate settings instead of the saved ones. */
export async function probe(target?: { url: string; apiKey?: string }): Promise<HealthProbe> {
  const url = target?.url ?? base();
  const apiKey = target ? target.apiKey : serverApiKey();
  const info = await requestJson<JfPublicInfo>(buildUrl(url, '/System/Info/Public'), {
    service: 'jellyfin',
  });
  if (!info?.Version || !info.ServerName) {
    throw new UpstreamError('This does not look like a Jellyfin server', undefined, 'jellyfin');
  }
  const result: HealthProbe = { version: info.Version, issues: [], meta: { server: info.ServerName } };
  if (apiKey) {
    const sys = await requestJson<JfSystemInfo>(buildUrl(url, '/System/Info'), {
      headers: authHeader(apiKey, 'streamforge-server'),
      service: 'jellyfin',
    });
    if (sys.HasPendingRestart)
      result.issues.push({ level: 'warning', message: 'Server restart pending', source: 'System' });
    if (sys.HasUpdateAvailable)
      result.issues.push({ level: 'info', message: 'An update is available', source: 'System' });
    if (sys.IsShuttingDown)
      result.issues.push({ level: 'error', message: 'Server is shutting down', source: 'System' });
    result.meta = { ...result.meta, os: sys.OperatingSystemDisplayName };
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Sessions / Now playing                                              */
/* ------------------------------------------------------------------ */

interface JfMediaStream {
  Type: 'Video' | 'Audio' | 'Subtitle' | string;
  Codec?: string;
  Width?: number;
  Height?: number;
  DisplayTitle?: string;
  Language?: string;
  BitRate?: number;
  Channels?: number;
  IsDefault?: boolean;
  VideoRangeType?: string;
}

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  MediaType?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  RunTimeTicks?: number;
  Overview?: string;
  Genres?: string[];
  OfficialRating?: string;
  CommunityRating?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesPrimaryImageTag?: string;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  Album?: string;
  AlbumArtist?: string;
  Artists?: string[];
  MediaStreams?: JfMediaStream[];
  DateCreated?: string;
  ChildCount?: number;
  UserData?: { Played?: boolean; UnplayedItemCount?: number };
}

interface JfSession {
  Id: string;
  UserId?: string;
  UserName?: string;
  UserPrimaryImageTag?: string;
  Client?: string;
  DeviceName?: string;
  DeviceId?: string;
  ApplicationVersion?: string;
  RemoteEndPoint?: string;
  LastActivityDate?: string;
  LastPlaybackCheckIn?: string;
  IsActive?: boolean;
  NowPlayingItem?: JfItem;
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
    IsMuted?: boolean;
    VolumeLevel?: number;
    PlayMethod?: 'DirectPlay' | 'DirectStream' | 'Transcode';
    RepeatMode?: string;
  };
  TranscodingInfo?: {
    VideoCodec?: string;
    AudioCodec?: string;
    Container?: string;
    Bitrate?: number;
    Width?: number;
    Height?: number;
    Framerate?: number;
    IsVideoDirect?: boolean;
    IsAudioDirect?: boolean;
    CompletionPercentage?: number;
    HardwareAccelerationType?: string;
    TranscodeReasons?: string[];
  };
}

export interface ArtworkRef {
  itemId: string;
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo';
  tag?: string;
}

function resolutionLabel(w?: number, h?: number) {
  if (!w || !h) return undefined;
  if (w >= 3800 || h >= 2100) return '4K';
  if (w >= 2500 || h >= 1400) return '1440p';
  if (w >= 1900 || h >= 1000) return '1080p';
  if (w >= 1260 || h >= 700) return '720p';
  if (h >= 560) return '576p';
  return `${h}p`;
}

function artworkFor(item: JfItem) {
  let poster: ArtworkRef | undefined;
  let backdrop: ArtworkRef | undefined;
  let logo: ArtworkRef | undefined;

  if (item.Type === 'Episode' && item.SeriesId) {
    poster = { itemId: item.SeriesId, type: 'Primary', tag: item.SeriesPrimaryImageTag };
  } else if (item.Type === 'Audio' && item.AlbumId) {
    poster = { itemId: item.AlbumId, type: 'Primary', tag: item.AlbumPrimaryImageTag };
  } else if (item.ImageTags?.Primary) {
    poster = { itemId: item.Id, type: 'Primary', tag: item.ImageTags.Primary };
  }

  if (item.BackdropImageTags?.length) {
    backdrop = { itemId: item.Id, type: 'Backdrop', tag: item.BackdropImageTags[0] };
  } else if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
    backdrop = { itemId: item.ParentBackdropItemId, type: 'Backdrop', tag: item.ParentBackdropImageTags[0] };
  }

  if (item.ImageTags?.Logo) logo = { itemId: item.Id, type: 'Logo', tag: item.ImageTags.Logo };
  else if (item.Type === 'Episode' && item.SeriesId) logo = { itemId: item.SeriesId, type: 'Logo' };

  const thumb: ArtworkRef | undefined =
    item.Type === 'Episode' && item.ImageTags?.Primary
      ? { itemId: item.Id, type: 'Primary', tag: item.ImageTags.Primary }
      : undefined;

  return { poster, backdrop, logo, thumb };
}

function normaliseSession(s: JfSession) {
  const item = s.NowPlayingItem!;
  const runtimeMs = Math.round((item.RunTimeTicks ?? 0) / TICKS_PER_MS);
  const positionMs = Math.round((s.PlayState?.PositionTicks ?? 0) / TICKS_PER_MS);
  const video = item.MediaStreams?.find((m) => m.Type === 'Video');
  const audio = item.MediaStreams?.find((m) => m.Type === 'Audio' && m.IsDefault) ??
    item.MediaStreams?.find((m) => m.Type === 'Audio');
  const t = s.TranscodingInfo;

  return {
    sessionId: s.Id,
    user: {
      id: s.UserId,
      name: s.UserName ?? 'Unknown user',
      imageTag: s.UserPrimaryImageTag,
    },
    client: s.Client,
    device: s.DeviceName,
    appVersion: s.ApplicationVersion,
    remoteAddress: s.RemoteEndPoint,
    lastActivity: s.LastPlaybackCheckIn ?? s.LastActivityDate,
    item: {
      id: item.Id,
      type: item.Type,
      mediaType: item.MediaType,
      title: item.Name,
      seriesName: item.SeriesName,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      album: item.Album,
      artist: item.AlbumArtist ?? item.Artists?.[0],
      year: item.ProductionYear,
      overview: item.Overview,
      genres: item.Genres?.slice(0, 3) ?? [],
      officialRating: item.OfficialRating,
      communityRating: item.CommunityRating,
      runtimeMs,
      resolution: resolutionLabel(video?.Width, video?.Height),
      hdr: video?.VideoRangeType && video.VideoRangeType !== 'SDR' ? video.VideoRangeType : undefined,
      videoCodec: video?.Codec,
      audio: audio?.DisplayTitle ?? audio?.Codec,
      ...artworkFor(item),
    },
    state: {
      positionMs,
      progress: runtimeMs > 0 ? Math.min(1, positionMs / runtimeMs) : 0,
      isPaused: !!s.PlayState?.IsPaused,
      isMuted: !!s.PlayState?.IsMuted,
      playMethod: s.PlayState?.PlayMethod ?? 'DirectPlay',
    },
    transcode: t
      ? {
          videoCodec: t.VideoCodec,
          audioCodec: t.AudioCodec,
          container: t.Container,
          bitrate: t.Bitrate,
          resolution: resolutionLabel(t.Width, t.Height),
          framerate: t.Framerate,
          isVideoDirect: !!t.IsVideoDirect,
          isAudioDirect: !!t.IsAudioDirect,
          completion: t.CompletionPercentage,
          hwAccel: t.HardwareAccelerationType,
          reasons: t.TranscodeReasons ?? [],
        }
      : undefined,
  };
}
export type NowPlaying = ReturnType<typeof normaliseSession>;

async function rawSessions(ctx: JfCtx) {
  return cache.get(`jf:sessions:${serverToken(ctx) === ctx.token ? ctx.userId : 'srv'}`, 2_000, () =>
    jf<JfSession[]>('/Sessions', serverToken(ctx), ctx.deviceId, { ActiveWithinSeconds: 960 }),
  );
}

export async function nowPlaying(ctx: JfCtx) {
  const list = await rawSessions(ctx);
  return list
    .filter((s) => s.NowPlayingItem)
    .map(normaliseSession)
    .sort((a, b) => Number(a.state.isPaused) - Number(b.state.isPaused));
}

/* ------------------------------------------------------------------ */
/* Library & server overview                                           */
/* ------------------------------------------------------------------ */

interface JfCounts {
  MovieCount: number;
  SeriesCount: number;
  EpisodeCount: number;
  ArtistCount: number;
  SongCount: number;
  AlbumCount: number;
  MusicVideoCount: number;
  BoxSetCount: number;
  BookCount: number;
  ItemCount: number;
}

interface JfVirtualFolder {
  Name: string;
  CollectionType?: string;
  ItemId: string;
  Locations: string[];
  PrimaryImageItemId?: string;
  RefreshStatus?: string;
  RefreshProgress?: number;
}

const COLLECTION_ITEM_TYPES: Record<string, string> = {
  movies: 'Movie',
  tvshows: 'Series',
  music: 'MusicAlbum',
  books: 'Book',
  musicvideos: 'MusicVideo',
  homevideos: 'Video,Photo',
  boxsets: 'BoxSet',
  photos: 'Photo',
};

async function libraries(ctx: JfCtx) {
  return cache.get(`jf:libraries:${ctx.userId}`, 5 * 60_000, async () => {
    const folders = await jf<JfVirtualFolder[]>('/Library/VirtualFolders', serverToken(ctx), ctx.deviceId);
    return Promise.all(
      folders.map(async (f) => {
        const types = f.CollectionType ? COLLECTION_ITEM_TYPES[f.CollectionType] : undefined;
        const count = await jf<{ TotalRecordCount: number }>('/Items', ctx.token, ctx.deviceId, {
          ParentId: f.ItemId,
          Recursive: true,
          Limit: 0,
          IncludeItemTypes: types,
          UserId: ctx.userId,
        }).catch(() => undefined);
        return {
          id: f.ItemId,
          name: f.Name,
          type: f.CollectionType ?? 'mixed',
          locations: f.Locations,
          itemCount: count?.TotalRecordCount,
          refreshing: f.RefreshStatus === 'Active',
          refreshProgress: f.RefreshProgress,
          image: { itemId: f.ItemId, type: 'Primary' as const },
        };
      }),
    );
  });
}

export async function overview(ctx: JfCtx) {
  const [info, counts, libs, users, sessionList] = await Promise.all([
    cache.get('jf:sysinfo', 30_000, () =>
      jf<JfSystemInfo>('/System/Info', serverToken(ctx), ctx.deviceId),
    ),
    cache.get(`jf:counts:${ctx.userId}`, 60_000, () =>
      jf<JfCounts>('/Items/Counts', ctx.token, ctx.deviceId, { UserId: ctx.userId }),
    ),
    libraries(ctx),
    cache.get('jf:users', 60_000, () => jf<JfUser[]>('/Users', serverToken(ctx), ctx.deviceId)),
    rawSessions(ctx),
  ]);

  const dayAgo = Date.now() - 86_400_000;
  const streams = sessionList.filter((s) => s.NowPlayingItem);
  return {
    server: {
      name: info.ServerName,
      version: info.Version,
      os: info.OperatingSystemDisplayName ?? info.OperatingSystem,
      architecture: info.SystemArchitecture,
      hasUpdateAvailable: !!info.HasUpdateAvailable,
      hasPendingRestart: !!info.HasPendingRestart,
    },
    counts: {
      movies: counts.MovieCount,
      series: counts.SeriesCount,
      episodes: counts.EpisodeCount,
      albums: counts.AlbumCount,
      songs: counts.SongCount,
      artists: counts.ArtistCount,
      books: counts.BookCount,
      musicVideos: counts.MusicVideoCount,
      collections: counts.BoxSetCount,
    },
    libraries: libs,
    users: {
      total: users.filter((u) => !u.Policy?.IsDisabled).length,
      active24h: users.filter((u) => u.LastActivityDate && Date.parse(u.LastActivityDate) > dayAgo).length,
      list: users
        .filter((u) => !u.Policy?.IsDisabled)
        .map((u) => ({
          id: u.Id,
          name: u.Name,
          imageTag: u.PrimaryImageTag,
          isAdmin: !!u.Policy?.IsAdministrator,
          lastActivity: u.LastActivityDate,
        }))
        .sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '')),
    },
    sessions: {
      active: sessionList.length,
      streams: streams.length,
      transcoding: streams.filter((s) => s.PlayState?.PlayMethod === 'Transcode').length,
      directPlay: streams.filter((s) => s.PlayState?.PlayMethod !== 'Transcode').length,
    },
  };
}

export async function latest(ctx: JfCtx, limit = 20) {
  return cache.get(`jf:latest:${ctx.userId}:${limit}`, 60_000, async () => {
    const items = await jf<JfItem[]>(`/Users/${ctx.userId}/Items/Latest`, ctx.token, ctx.deviceId, {
      Limit: limit,
      Fields: 'PrimaryImageAspectRatio,ProductionYear,DateCreated,Overview,Genres,CommunityRating',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      GroupItems: true,
    });
    return items.map((i) => ({
      id: i.Id,
      type: i.Type,
      title: i.Type === 'Episode' ? (i.SeriesName ?? i.Name) : i.Name,
      subtitle:
        i.Type === 'Episode'
          ? `S${i.ParentIndexNumber ?? 0}·E${i.IndexNumber ?? 0} — ${i.Name}`
          : i.Type === 'Series' && i.ChildCount
            ? `${i.ChildCount} new`
            : i.Type === 'MusicAlbum'
              ? i.AlbumArtist
              : undefined,
      year: i.ProductionYear,
      added: i.DateCreated,
      rating: i.CommunityRating,
      ...artworkFor(i),
    }));
  });
}

interface JfActivity {
  Id: number;
  Name: string;
  ShortOverview?: string;
  Overview?: string;
  Type: string;
  Date: string;
  UserId?: string;
  Severity: 'Information' | 'Warning' | 'Error' | string;
}

export async function activity(ctx: JfCtx, limit = 25) {
  return cache.get(`jf:activity:${limit}`, 15_000, async () => {
    const res = await jf<{ Items: JfActivity[] }>('/System/ActivityLog/Entries', serverToken(ctx), ctx.deviceId, {
      limit,
      startIndex: 0,
    });
    return res.Items.map((a) => ({
      id: a.Id,
      name: a.Name,
      overview: a.ShortOverview ?? a.Overview,
      type: a.Type,
      date: a.Date,
      severity: a.Severity,
      userId: a.UserId,
    }));
  });
}

/** Daily playback counts derived from the server activity log. */
export async function playbackHistory(ctx: JfCtx, days = 14) {
  return cache.get(`jf:playhistory:${days}`, 5 * 60_000, async () => {
    const minDate = new Date(Date.now() - days * 86_400_000);
    minDate.setHours(0, 0, 0, 0);
    const res = await jf<{ Items: JfActivity[] }>('/System/ActivityLog/Entries', serverToken(ctx), ctx.deviceId, {
      minDate: minDate.toISOString(),
      limit: 2000,
    });
    const buckets = new Map<string, { date: string; plays: number; users: Set<string> }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(minDate.getTime() + (i + 1) * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, plays: 0, users: new Set() });
    }
    for (const a of res.Items) {
      if (a.Type !== 'VideoPlayback' && a.Type !== 'AudioPlayback') continue;
      const key = a.Date.slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.plays++;
      if (a.UserId) b.users.add(a.UserId);
    }
    return [...buckets.values()].map((b) => ({ date: b.date, plays: b.plays, users: b.users.size }));
  });
}

/* ------------------------------------------------------------------ */
/* Image proxy                                                         */
/* ------------------------------------------------------------------ */

const ID_RE = /^[a-f0-9]{32}$|^[a-f0-9-]{36}$/i;
const IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Thumb', 'Logo', 'Banner', 'Art']);

export function isValidId(id: string) {
  return ID_RE.test(id);
}
export function isValidImageType(t: string) {
  return IMAGE_TYPES.has(t);
}

export async function image(
  ctx: JfCtx,
  kind: 'Items' | 'Users',
  id: string,
  type: string,
  opts: { tag?: string; maxWidth?: number; quality?: number },
) {
  return requestRaw(
    buildUrl(base(), `/${kind}/${id}/Images/${type}`, {
      tag: opts.tag,
      maxWidth: opts.maxWidth,
      quality: opts.quality ?? 90,
    }),
    { headers: { ...authHeader(ctx.token, ctx.deviceId), Accept: 'image/*' }, service: 'jellyfin' },
  );
}

/* ------------------------------------------------------------------ */
/* Session controls                                                    */
/* ------------------------------------------------------------------ */

export const SESSION_ID_RE = /^[\w-]{1,64}$/;
export type SessionCommand = 'pause' | 'unpause' | 'stop' | 'message';

/** Controls a playback session. Needs an administrator token. */
export async function controlSession(ctx: JfCtx, sessionId: string, command: SessionCommand, text?: string) {
  const token = serverToken(ctx);
  const path =
    command === 'message'
      ? `/Sessions/${sessionId}/Message`
      : `/Sessions/${sessionId}/Playing/${command === 'pause' ? 'Pause' : command === 'unpause' ? 'Unpause' : 'Stop'}`;
  await requestJson(buildUrl(base(), path), {
    method: 'POST',
    headers: authHeader(token, ctx.deviceId),
    body: command === 'message' ? { Header: 'Message from the server admin', Text: text ?? '', TimeoutMs: 15_000 } : undefined,
    service: 'jellyfin',
  });
  cache.delete('jf:sessions:');
}

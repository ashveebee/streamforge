/**
 * StreamForge demo API.
 *
 * Serves realistic, entirely fictional data in the same shapes as the real
 * backend, so the UI can be explored (and the README screenshots re-created)
 * without a Jellyfin server or any *arr services. All titles, people and
 * artwork are made up; artwork is generated SVG.
 *
 *   npm run demo      → UI on http://localhost:5173, already signed in
 */
import express from 'express';
import type {
  ActivityEntry,
  AutoImportEntry,
  AutoImportStatus,
  CleanupStatus,
  NotificationsStatus,
  DownloadSnapshot,
  HealthSnapshot,
  HostSnapshot,
  InfinidiskOverview,
  JellyfinOverview,
  LatestItem,
  NowPlaying,
  PlayDay,
  ProwlarrOverview,
  QueueItem,
  RadarrOverview,
  SeerrOverview,
  SeerrRequest,
  ServiceHealth,
  ServiceId,
  ServiceSettingsView,
  SonarrOverview,
  UpcomingItem,
} from '../src/lib/types.js';

const PORT = Number(process.env.DEMO_PORT ?? 4010);
const START = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

function hash(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rng(seed: string | number) {
  let a = typeof seed === 'number' ? seed : hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

/* -------------------------------------------------------------------------- */
/* Catalogue (all fictional)                                                   */
/* -------------------------------------------------------------------------- */

interface Title {
  title: string;
  year: number;
  kind: 'movie' | 'series';
  genres: string[];
  rating: number;
  network?: string;
  overview: string;
}

const MOVIES: Title[] = [
  { title: 'The Glass Meridian', year: 2025, kind: 'movie', genres: ['Sci-Fi', 'Mystery'], rating: 8.1, overview: 'A cartographer of collapsing timelines must chart a way home before her map forgets her.' },
  { title: 'Neon Harbor', year: 2024, kind: 'movie', genres: ['Thriller', 'Crime'], rating: 7.6, overview: 'A dockside fixer takes one last job in a city that never turns its lights off.' },
  { title: 'Saltwind', year: 2025, kind: 'movie', genres: ['Drama', 'Adventure'], rating: 7.9, overview: 'Three sisters sail their late father’s boat across an ocean he never finished crossing.' },
  { title: 'Quiet Orbit', year: 2024, kind: 'movie', genres: ['Sci-Fi', 'Drama'], rating: 8.4, overview: 'The last engineer aboard a silent station starts hearing music from the dark side of the moon.' },
  { title: 'Ember & Ash', year: 2023, kind: 'movie', genres: ['Fantasy', 'Action'], rating: 7.2, overview: 'A disgraced fire-keeper and a thief steal back the flame that keeps their valley alive.' },
  { title: 'The Last Lighthouse', year: 2026, kind: 'movie', genres: ['Horror', 'Mystery'], rating: 6.9, overview: 'A keeper takes a winter post on an island where the light must never go out.' },
  { title: 'Paper Kingdoms', year: 2023, kind: 'movie', genres: ['Animation', 'Family'], rating: 8.0, overview: 'Origami creatures come to life to save the bookshop that folded them.' },
  { title: 'Northbound', year: 2025, kind: 'movie', genres: ['Drama'], rating: 7.4, overview: 'Estranged brothers drive their grandmother’s ashes to the top of the world.' },
  { title: 'Velvet Static', year: 2026, kind: 'movie', genres: ['Music', 'Romance'], rating: 7.0, overview: 'Two late-night radio hosts fall for each other’s voices without ever meeting.' },
  { title: 'Iron Bloom', year: 2026, kind: 'movie', genres: ['Action', 'Sci-Fi'], rating: 7.3, overview: 'In a city of machines, a gardener grows the first living flower in a century.' },
  { title: 'Lanterns Over Kessa', year: 2024, kind: 'movie', genres: ['Adventure'], rating: 7.7, overview: 'A balloon courier delivers letters across a war that everyone else has forgotten.' },
  { title: 'Small Hours', year: 2025, kind: 'movie', genres: ['Comedy', 'Drama'], rating: 7.1, overview: 'A night-shift pharmacist and her regulars try to save the store from closing.' },
];

const SERIES: Title[] = [
  { title: 'Signal Fire', year: 2024, kind: 'series', genres: ['Drama', 'Thriller'], rating: 8.6, network: 'Northlight', overview: 'Wildfire lookouts uncover a conspiracy hidden in the smoke.' },
  { title: 'The Cartographers', year: 2025, kind: 'series', genres: ['Mystery', 'Fantasy'], rating: 8.3, network: 'Atlas+', overview: 'Mapmakers discover a town that appears on only one map in the world.' },
  { title: 'Low Tide', year: 2023, kind: 'series', genres: ['Crime', 'Drama'], rating: 8.0, network: 'Harbor TV', overview: 'A coastal detective reopens the case that drowned her career.' },
  { title: 'Starfall Academy', year: 2025, kind: 'series', genres: ['Sci-Fi', 'Animation'], rating: 8.2, network: 'Orbit Kids', overview: 'Cadets at a school built inside a comet learn to steer it home.' },
  { title: 'Copper Valley', year: 2022, kind: 'series', genres: ['Western', 'Drama'], rating: 7.8, network: 'Frontier', overview: 'Rival mining families share one river and a century of grudges.' },
  { title: 'Atlas Station', year: 2026, kind: 'series', genres: ['Sci-Fi'], rating: 8.5, network: 'Atlas+', overview: 'Life, politics and murder on the first city at the bottom of the sea.' },
  { title: 'Kitchen Brigade', year: 2024, kind: 'series', genres: ['Comedy'], rating: 7.9, network: 'Northlight', overview: 'A burned-out chef takes over her uncle’s chaotic seaside diner.' },
  { title: 'The Long Winter', year: 2023, kind: 'series', genres: ['Drama', 'History'], rating: 8.1, network: 'Frontier', overview: 'A mountain village survives the year the sun didn’t rise.' },
];

const ALL = [...MOVIES, ...SERIES];
const byTitle = new Map(ALL.map((t) => [slug(t.title), t]));
const find = (title: string) => byTitle.get(slug(title))!;

const USERS = [
  { id: 'u-alex', name: 'Alex', isAdmin: true },
  { id: 'u-maya', name: 'Maya', isAdmin: false },
  { id: 'u-jonah', name: 'Jonah', isAdmin: false },
  { id: 'u-priya', name: 'Priya', isAdmin: false },
  { id: 'u-leo', name: 'Leo', isAdmin: false },
  { id: 'u-sam', name: 'Sam', isAdmin: true },
];

/* -------------------------------------------------------------------------- */
/* Generated artwork                                                           */
/* -------------------------------------------------------------------------- */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Layered landscape silhouette path across a width. */
function ridge(r: () => number, w: number, h: number, base: number, amp: number) {
  const pts: string[] = [`M0 ${h}`, `L0 ${base}`];
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const x = (w / steps) * i;
    const y = base - amp * (0.3 + r() * 0.7) + (i % 2 ? 0 : amp * 0.35);
    const cx = x - w / steps / 2;
    pts.push(`Q${cx.toFixed(0)} ${(y - amp * r() * 0.5).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)}`);
  }
  pts.push(`L${w} ${h}`, 'Z');
  return pts.join(' ');
}

function art(seed: string, shape: 'poster' | 'backdrop' | 'wide', title?: string, subtitle?: string) {
  const r = rng(seed);
  const [w, h] = shape === 'poster' ? [600, 900] : shape === 'wide' ? [960, 540] : [1920, 1080];
  const hue = Math.floor(r() * 360);
  const hue2 = (hue + 30 + Math.floor(r() * 80)) % 360;
  const sky1 = `hsl(${hue} 70% ${18 + r() * 10}%)`;
  const sky2 = `hsl(${hue2} 75% ${42 + r() * 14}%)`;
  const sunX = w * (0.25 + r() * 0.5);
  const sunY = h * (shape === 'poster' ? 0.32 : 0.38);
  const sunR = Math.min(w, h) * (0.12 + r() * 0.1);
  const layers = [0.62, 0.72, 0.84]
    .map((f, i) => {
      const l = 8 + i * 4;
      return `<path d="${ridge(r, w, h, h * f, h * (0.16 - i * 0.03))}" fill="hsl(${hue} 45% ${l}%)" opacity="${0.75 + i * 0.1}"/>`;
    })
    .join('');
  const stars = Array.from({ length: 40 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h * 0.5).toFixed(0)}" r="${(r() * 1.6 + 0.3).toFixed(1)}" fill="#fff" opacity="${(r() * 0.6 + 0.2).toFixed(2)}"/>`).join('');
  const text =
    shape === 'poster' && title
      ? `<rect y="${h * 0.66}" width="${w}" height="${h * 0.34}" fill="url(#fade)"/>
         <text x="${w / 2}" y="${h * 0.86}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${title.length > 16 ? 44 : 56}" font-weight="700" letter-spacing="2" fill="#fff">${esc(title.toUpperCase())}</text>
         ${subtitle ? `<text x="${w / 2}" y="${h * 0.92}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="#fff" opacity="0.7">${esc(subtitle)}</text>` : ''}`
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky1}"/><stop offset="0.7" stop-color="${sky2}"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="hsl(${hue2} 100% 85%)" stop-opacity="0.95"/><stop offset="0.35" stop-color="hsl(${hue2} 100% 70%)" stop-opacity="0.45"/><stop offset="1" stop-color="hsl(${hue2} 100% 60%)" stop-opacity="0"/></radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.75"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  ${stars}
  <circle cx="${sunX}" cy="${sunY}" r="${sunR * 3}" fill="url(#glow)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${sunR * 0.55}" fill="hsl(${hue2} 100% 88%)"/>
  ${layers}
  ${text}
</svg>`;
}

const poster = (t: string) => `/api/demo/art/poster/${slug(t)}.svg`;
const backdropUrl = (t: string) => `/api/demo/art/backdrop/${slug(t)}.svg`;
/** Jellyfin-style artwork reference; served by the image route below. */
const jfArt = (t: string, type: 'Primary' | 'Backdrop' | 'Thumb') => ({ itemId: slug(t), type, tag: 'demo' });

/* -------------------------------------------------------------------------- */
/* Jellyfin                                                                    */
/* -------------------------------------------------------------------------- */

interface Stream {
  user: (typeof USERS)[number];
  title: string;
  episode?: { season: number; number: number; name: string };
  runtimeMin: number;
  startedMinAgo: number;
  paused?: boolean;
  client: string;
  device: string;
  resolution: string;
  hdr?: string;
  videoCodec: string;
  audio: string;
  transcode?: NowPlaying['transcode'];
}

const STREAMS: Stream[] = [
  {
    user: USERS[1]!,
    title: 'Signal Fire',
    episode: { season: 2, number: 5, name: 'The Smoke Line' },
    runtimeMin: 54,
    startedMinAgo: 31,
    client: 'Jellyfin Android TV',
    device: 'Living Room TV',
    resolution: '4K',
    hdr: 'Dolby Vision',
    videoCodec: 'HEVC',
    audio: 'EAC3 5.1',
  },
  {
    user: USERS[2]!,
    title: 'Quiet Orbit',
    runtimeMin: 128,
    startedMinAgo: 47,
    client: 'Jellyfin Web',
    device: 'Firefox on Linux',
    resolution: '1080p',
    videoCodec: 'HEVC',
    audio: 'TrueHD 7.1',
    transcode: {
      videoCodec: 'h264',
      audioCodec: 'aac',
      container: 'ts',
      bitrate: 12_000_000,
      resolution: '1080p',
      framerate: 23.976,
      isVideoDirect: false,
      isAudioDirect: false,
      completion: 62,
      hwAccel: 'VAAPI',
      reasons: ['VideoCodecNotSupported', 'AudioCodecNotSupported'],
    },
  },
  {
    user: USERS[3]!,
    title: 'The Cartographers',
    episode: { season: 1, number: 3, name: 'Here Be Dragons' },
    runtimeMin: 48,
    startedMinAgo: 12,
    paused: true,
    client: 'Jellyfin iOS',
    device: 'iPad',
    resolution: '1080p',
    hdr: 'HDR10',
    videoCodec: 'HEVC',
    audio: 'AAC 2.0',
  },
];

function nowPlaying(): NowPlaying[] {
  return STREAMS.map((s, i) => {
    const t = find(s.title);
    const runtimeMs = s.runtimeMin * MIN;
    const elapsed = s.paused ? s.startedMinAgo * MIN : s.startedMinAgo * MIN + (Date.now() - START);
    const positionMs = elapsed % runtimeMs;
    return {
      sessionId: `demo-session-${i}`,
      user: { id: s.user.id, name: s.user.name },
      client: s.client,
      device: s.device,
      appVersion: '10.11.2',
      lastActivity: iso(5_000),
      item: {
        id: `${slug(s.title)}${s.episode ? `-s${s.episode.season}e${s.episode.number}` : ''}`,
        type: s.episode ? 'Episode' : 'Movie',
        mediaType: 'Video',
        title: s.episode ? s.episode.name : t.title,
        seriesName: s.episode ? t.title : undefined,
        seasonNumber: s.episode?.season,
        episodeNumber: s.episode?.number,
        year: t.year,
        overview: t.overview,
        genres: t.genres,
        officialRating: s.episode ? 'TV-14' : 'PG-13',
        communityRating: t.rating,
        runtimeMs,
        resolution: s.resolution,
        hdr: s.hdr,
        videoCodec: s.videoCodec,
        audio: s.audio,
        poster: jfArt(t.title, 'Primary'),
        backdrop: jfArt(t.title, 'Backdrop'),
        thumb: jfArt(t.title, 'Thumb'),
      },
      state: {
        positionMs,
        progress: positionMs / runtimeMs,
        isPaused: !!s.paused,
        isMuted: false,
        playMethod: s.transcode ? 'Transcode' : 'DirectPlay',
      },
      transcode: s.transcode,
    };
  });
}

function jellyfinOverview(): JellyfinOverview {
  return {
    server: { name: 'Homelab', version: '10.11.2', os: 'Linux', architecture: 'X64', hasUpdateAvailable: false, hasPendingRestart: false },
    counts: { movies: 1284, series: 212, episodes: 9640, albums: 486, songs: 7213, artists: 391, books: 0, musicVideos: 0, collections: 38 },
    libraries: [
      { id: 'lib-movies', name: 'Movies', type: 'movies', locations: ['/media/movies'], itemCount: 1284, refreshing: false, image: jfArt('Lanterns Over Kessa', 'Backdrop') },
      { id: 'lib-shows', name: 'TV Shows', type: 'tvshows', locations: ['/media/tv'], itemCount: 212, refreshing: true, refreshProgress: 64, image: jfArt('Atlas Station', 'Backdrop') },
      { id: 'lib-music', name: 'Music', type: 'music', locations: ['/media/music'], itemCount: 486, refreshing: false, image: jfArt('Velvet Static', 'Backdrop') },
      { id: 'lib-kids', name: 'Kids', type: 'mixed', locations: ['/media/kids'], itemCount: 174, refreshing: false, image: jfArt('Paper Kingdoms', 'Backdrop') },
    ],
    users: {
      total: USERS.length,
      active24h: 4,
      list: USERS.map((u, i) => ({ id: u.id, name: u.name, isAdmin: u.isAdmin, lastActivity: iso([2, 1, 1, 3, 26 * 60, 9 * 60][i]! * MIN) })),
    },
    sessions: { active: 5, streams: STREAMS.length, transcoding: 1, directPlay: 2 },
  };
}

const LATEST_ORDER = ['Iron Bloom', 'Atlas Station', 'The Last Lighthouse', 'Velvet Static', 'Kitchen Brigade', 'The Glass Meridian', 'Saltwind', 'Starfall Academy', 'Northbound', 'Small Hours', 'Neon Harbor', 'Low Tide'];

function latest(): LatestItem[] {
  return LATEST_ORDER.map((name, i) => {
    const t = find(name);
    return {
      id: slug(name),
      type: t.kind === 'movie' ? 'Movie' : 'Series',
      title: t.title,
      subtitle: t.kind === 'series' ? `${1 + (i % 3)} new episodes` : t.genres.join(' · '),
      year: t.year,
      added: iso((i * 7 + 2) * HOUR),
      rating: t.rating,
      poster: jfArt(name, 'Primary'),
      backdrop: jfArt(name, 'Backdrop'),
      thumb: jfArt(name, 'Thumb'),
    };
  });
}

function activity(): ActivityEntry[] {
  const e: [string, string, string, number, string?][] = [
    ['Maya is playing Signal Fire - S2E5 - The Smoke Line on Living Room TV', 'VideoPlayback', 'Information', 31, 'u-maya'],
    ['Jonah is playing Quiet Orbit on Firefox on Linux', 'VideoPlayback', 'Information', 47, 'u-jonah'],
    ['Priya successfully authenticated', 'AuthenticationSucceeded', 'Information', 58, 'u-priya'],
    ['Iron Bloom was added to Movies', 'ItemAdded', 'Information', 2 * 60],
    ['Leo has finished playing Starfall Academy - S1E8', 'VideoPlaybackStopped', 'Information', 3 * 60, 'u-leo'],
    ['Scan Media Library completed', 'TaskCompleted', 'Information', 4 * 60],
    ['Subtitles failed to download for Low Tide - S3E2', 'SubtitleDownloadFailure', 'Warning', 6 * 60],
    ['Atlas Station - S1E4 was added to TV Shows', 'ItemAdded', 'Information', 9 * 60],
    ['Sam successfully authenticated', 'AuthenticationSucceeded', 'Information', 9 * 60 + 5, 'u-sam'],
    ['Failed login attempt from 203.0.113.24', 'AuthenticationFailed', 'Error', 14 * 60],
  ];
  return e.map(([name, type, severity, minAgo, userId], i) => ({ id: 1000 - i, name, type, severity, date: iso(minAgo * MIN), userId }));
}

function plays(): PlayDay[] {
  const r = rng('plays');
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * DAY);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const plays = Math.round(14 + r() * 12 + (weekend ? 14 : 0) + i * 0.3);
    return { date: d.toISOString().slice(0, 10), plays, users: Math.min(USERS.length, 2 + Math.round(r() * 3) + (weekend ? 1 : 0)) };
  });
}

/* -------------------------------------------------------------------------- */
/* Health, host, downloads                                                     */
/* -------------------------------------------------------------------------- */

const VERSIONS: Record<ServiceId, string> = {
  jellyfin: '10.11.2',
  sonarr: '4.0.15.2941',
  radarr: '6.0.4.10291',
  prowlarr: '2.1.5.5216',
  seerr: '3.0.1',
  infinidisk: '2.0.0',
};
const BASE_MS: Record<ServiceId, number> = { jellyfin: 38, sonarr: 64, radarr: 71, prowlarr: 112, seerr: 55, infinidisk: 22 };

function health(): HealthSnapshot {
  const now = Date.now();
  const services: ServiceHealth[] = (Object.keys(VERSIONS) as ServiceId[]).map((id) => {
    const r = rng(id);
    const history = Array.from({ length: 60 }, (_, i) => ({
      t: now - (59 - i) * 30_000,
      ms: Math.round(BASE_MS[id] * (0.75 + r() * 0.5) + (r() > 0.95 ? BASE_MS[id] * 2 : 0)),
    }));
    const issues: ServiceHealth['issues'] =
      id === 'prowlarr'
        ? [{ level: 'warning', message: 'Indexers unavailable due to failures for more than 6 hours: Stormfront', source: 'IndexerLongTermStatusCheck' }]
        : id === 'sonarr'
          ? [{ level: 'info', message: 'New update is available', source: 'UpdateCheck' }]
          : [];
    return {
      id,
      kind: id,
      name: id === 'infinidisk' ? 'Infinidisk' : id[0]!.toUpperCase() + id.slice(1),
      configured: true,
      status: id === 'prowlarr' ? 'degraded' : 'healthy',
      reason: id === 'prowlarr' ? issues[0]!.message : undefined,
      version: VERSIONS[id],
      latencyMs: history.at(-1)!.ms!,
      lastCheck: iso(4_000),
      lastSuccess: iso(4_000),
      issues,
      meta: id === 'jellyfin' ? { server: 'Homelab' } : undefined,
      uptime: 1,
      history,
    };
  });
  return {
    services,
    checkedAt: iso(4_000),
    intervalMs: 30_000,
    summary: { healthy: 5, degraded: 1, offline: 0, unconfigured: 0 },
  };
}

function host(): HostSnapshot {
  const now = Date.now();
  const r = rng(Math.floor(now / 5000));
  const wave = (i: number, p: number) => Math.sin((now / 1000 + i * 5) / p);
  const history = Array.from({ length: 60 }, (_, i) => ({
    t: now - (59 - i) * 5_000,
    cpu: 0.22 + 0.12 * wave(i, 40) + 0.05 * Math.sin(i * 1.7),
    mem: 0.58 + 0.03 * wave(i, 90),
    rx: 9_000_000 + 6_000_000 * (wave(i, 25) + 1),
    tx: 3_000_000 + 2_500_000 * (wave(i, 33) + 1),
  }));
  const cur = history.at(-1)!;
  return {
    enabled: true,
    info: { hostname: 'homelab', platform: 'linux', distro: 'Debian GNU/Linux 13', cpuModel: 'AMD Ryzen 7 5700G', cores: 16, memTotal: 64 * GB },
    current: {
      cpu: cur.cpu,
      perCore: Array.from({ length: 16 }, (_, i) => Math.max(0.02, Math.min(0.98, cur.cpu + (r() - 0.5) * 0.35 + (i === 3 ? 0.3 : 0)))),
      memUsed: cur.mem * 64 * GB,
      memTotal: 64 * GB,
      swapUsed: 0.4 * GB,
      swapTotal: 8 * GB,
      rx: cur.rx,
      tx: cur.tx,
      load: [2.41, 2.18, 1.97],
      uptime: 23 * DAY + 4 * HOUR,
      temperature: 54,
    },
    history,
    filesystems: [
      { mount: '/', fs: '/dev/nvme0n1p2', type: 'ext4', size: 1 * TB, used: 0.31 * TB, available: 0.69 * TB, usage: 0.31 },
      { mount: '/mnt/media', fs: 'pool/media', type: 'zfs', size: 48 * TB, used: 33.6 * TB, available: 14.4 * TB, usage: 0.7 },
      { mount: '/mnt/downloads', fs: '/dev/sdb1', type: 'xfs', size: 4 * TB, used: 1.1 * TB, available: 2.9 * TB, usage: 0.275 },
    ],
  };
}

function queue(source: 'sonarr' | 'radarr'): QueueItem[] {
  const elapsed = (Date.now() - START) / 1000;
  const items =
    source === 'sonarr'
      ? [
          { title: 'Atlas Station', subtitle: 'S1E5 · Pressure', size: 3.2 * GB, pct: 0.42, rate: 9e6, quality: 'WEBDL-2160p' },
          { title: 'Kitchen Brigade', subtitle: 'S2E1 · Family Meal', size: 1.4 * GB, pct: 0.81, rate: 4e6, quality: 'WEBDL-1080p' },
          { title: 'The Long Winter', subtitle: 'S1E7 · First Thaw', size: 2.1 * GB, pct: 0.08, rate: 0, quality: 'Bluray-1080p', queued: true },
        ]
      : [
          { title: 'Iron Bloom', subtitle: '2026', size: 18.4 * GB, pct: 0.57, rate: 22e6, quality: 'Bluray-2160p' },
          { title: 'Lanterns Over Kessa', subtitle: '2024', size: 8.7 * GB, pct: 0.23, rate: 11e6, quality: 'Remux-1080p' },
        ];
  const stuck: QueueItem[] =
    source === 'sonarr'
      ? [
          {
            id: 9,
            source,
            instance: source,
            title: 'Low Tide',
            subtitle: 'S3E3 · Riptide',
            releaseTitle: 'Low.Tide.UK.S03E03.1080p.WEB.H264-DEMO',
            status: 'completed',
            trackedState: 'importPending',
            trackedStatus: 'warning',
            protocol: 'torrent',
            client: 'qBittorrent',
            quality: 'WEBDL-1080p',
            size: 1.9 * GB,
            sizeLeft: 0,
            progress: 1,
            warnings: ['Found matching series via grab history, but release was matched to series by ID. Automatic import is not possible.'],
            poster: poster('Low Tide'),
          },
        ]
      : [];
  return [...items.map((it, i) => {
    const left = Math.max(0.05 * it.size, it.size * (1 - it.pct) - it.rate * elapsed);
    const progress = 1 - left / it.size;
    return {
      id: i + 1,
      source,
      instance: source,
      title: it.title,
      subtitle: it.subtitle,
      releaseTitle: `${it.title.replace(/\s+/g, '.')}.${it.quality}.DEMO-GROUP`,
      status: 'queued' in it ? 'queued' : 'downloading',
      trackedState: 'downloading',
      trackedStatus: 'ok',
      protocol: i % 2 ? 'torrent' : 'usenet',
      client: i % 2 ? 'qBittorrent' : 'SABnzbd',
      quality: it.quality,
      size: it.size,
      sizeLeft: left,
      progress,
      timeLeft: it.rate ? new Date((left / it.rate) * 1000).toISOString().slice(11, 19) : undefined,
      estimatedCompletion: it.rate ? ahead((left / it.rate) * 1000) : undefined,
      warnings: [],
      poster: poster(it.title),
    };
  }), ...stuck];
}

function downloads(): DownloadSnapshot {
  const now = Date.now();
  const history = Array.from({ length: 120 }, (_, i) => ({
    t: now - (119 - i) * 5_000,
    sonarr: Math.round(13e6 + 4e6 * Math.sin((now / 1000 + i * 5) / 60) + 2e6 * Math.sin(i)),
    radarr: Math.round(33e6 + 8e6 * Math.sin((now / 1000 + i * 5) / 45) + 3e6 * Math.cos(i * 1.3)),
  }));
  const last = history.at(-1)!;
  return {
    available: true,
    current: last.sonarr + last.radarr,
    peak: Math.max(...history.map((h) => h.sonarr + h.radarr)),
    history,
    itemSpeeds: { 'sonarr:1': 9e6, 'sonarr:2': 4e6, 'sonarr:3': 0, 'radarr:1': 22e6, 'radarr:2': 11e6 },
    stalled: { 'sonarr:3': iso(2 * HOUR + 14 * MIN) },
    sampleIntervalMs: 5_000,
  };
}

/* -------------------------------------------------------------------------- */
/* *arr, Seerr, Infinidisk                                                     */
/* -------------------------------------------------------------------------- */

function upcoming(source: 'sonarr' | 'radarr'): UpcomingItem[] {
  if (source === 'sonarr') {
    const eps: [string, string, number][] = [
      ['Signal Fire', 'S2E6 · Backburn', 0.4],
      ['Atlas Station', 'S1E6 · Crush Depth', 1.3],
      ['The Cartographers', 'S1E4 · Terra Incognita', 2.2],
      ['Kitchen Brigade', 'S2E2 · Mise en Place', 3.5],
      ['Starfall Academy', 'S2E1 · Perihelion', 5.1],
      ['Low Tide', 'S3E4 · Undertow', 6.4],
    ];
    return eps.map(([t, sub, d], i) => ({
      id: `sonarr-up-${i}`,
      source,
      title: t,
      subtitle: sub,
      date: ahead(d * DAY),
      kind: 'episode',
      hasFile: false,
      monitored: true,
      network: find(t).network,
      poster: poster(t),
    }));
  }
  const films: [string, UpcomingItem['kind'], number][] = [
    ['The Last Lighthouse', 'digital', 1.8],
    ['Velvet Static', 'cinema', 4.2],
    ['Iron Bloom', 'physical', 9],
    ['Small Hours', 'digital', 12],
  ];
  return films.map(([t, kind, d], i) => ({
    id: `radarr-up-${i}-${kind}`,
    source,
    title: t,
    subtitle: String(find(t).year),
    date: ahead(d * DAY),
    kind,
    hasFile: false,
    monitored: true,
    poster: poster(t),
  }));
}

function sonarr(): SonarrOverview {
  const q = queue('sonarr');
  return {
    stats: { series: 212, monitored: 187, continuing: 64, ended: 148, episodes: 10_412, episodeFiles: 9_640, sizeOnDisk: 21.7 * TB, missing: 38 },
    queue: { total: q.length, items: q },
    upcoming: upcoming('sonarr'),
    recent: SERIES.map((t, i) => ({
      id: i + 1,
      title: t.title,
      year: t.year,
      network: t.network,
      status: i % 3 === 2 ? 'ended' : 'continuing',
      progress: [1, 0.92, 1, 0.75, 1, 0.4, 0.88, 1][i]!,
      poster: poster(t.title),
    })),
    disks: [
      { path: '/mnt/media', label: 'media', free: 14.4 * TB, total: 48 * TB },
      { path: '/mnt/downloads', label: 'downloads', free: 2.9 * TB, total: 4 * TB },
    ],
  };
}

function radarr(): RadarrOverview {
  const q = queue('radarr');
  return {
    stats: { movies: 1342, monitored: 1210, downloaded: 1284, missing: 41, unreleased: 17, sizeOnDisk: 11.9 * TB },
    qualities: [
      { name: 'Bluray-1080p', count: 512 },
      { name: 'WEBDL-1080p', count: 341 },
      { name: 'Bluray-2160p', count: 218 },
      { name: 'Remux-1080p', count: 96 },
      { name: 'WEBDL-2160p', count: 74 },
      { name: 'DVD', count: 43 },
    ],
    queue: { total: q.length, items: q },
    upcoming: upcoming('radarr'),
    recent: MOVIES.map((t, i) => ({ id: i + 1, title: t.title, year: t.year, hasFile: i !== 5 && i !== 9, poster: poster(t.title) })),
    disks: [{ path: '/mnt/media', label: 'media', free: 14.4 * TB, total: 48 * TB }],
  };
}

function prowlarr(): ProwlarrOverview {
  const defs: [string, string, string, number, number, number, number, number, ProwlarrOverview['indexers'][number]['health']][] = [
    ['NewsHarbor', 'usenet', 'private', 180, 4120, 612, 3, 0, 'healthy'],
    ['Binary Bay', 'usenet', 'private', 240, 3890, 455, 11, 1, 'healthy'],
    ['Lumen Trackers', 'torrent', 'private', 410, 2930, 201, 24, 2, 'healthy'],
    ['OpenReel', 'torrent', 'public', 690, 2110, 96, 61, 4, 'healthy'],
    ['Archivist', 'torrent', 'semiPrivate', 520, 1450, 73, 18, 0, 'healthy'],
    ['Stormfront', 'torrent', 'public', 2900, 840, 12, 402, 9, 'failing'],
    ['Old Faithful', 'usenet', 'private', 0, 0, 0, 0, 0, 'disabled'],
  ];
  const indexers = defs.map(([name, protocol, privacy, ms, queries, grabs, failedQ, failedG, health], i) => ({
    id: i + 1,
    name,
    enabled: health !== 'disabled',
    protocol,
    privacy,
    priority: 25,
    implementation: protocol === 'usenet' ? 'Newznab' : 'Cardigann',
    health,
    disabledUntil: health === 'failing' ? ahead(2 * HOUR) : undefined,
    lastFailure: health === 'failing' ? iso(20 * MIN) : undefined,
    stats: {
      avgResponseMs: ms,
      queries,
      grabs,
      rssQueries: Math.round(queries * 0.6),
      authQueries: Math.round(queries * 0.1),
      failedQueries: failedQ,
      failedGrabs: failedG,
      successRate: queries ? 1 - failedQ / queries : undefined,
    },
  }));
  const sum = (k: keyof (typeof indexers)[number]['stats']) => indexers.reduce((a, x) => a + (x.stats[k] ?? 0), 0);
  return {
    summary: {
      total: indexers.length,
      enabled: indexers.filter((x) => x.enabled).length,
      healthy: indexers.filter((x) => x.health === 'healthy').length,
      failing: 1,
      disabled: 1,
      torrent: indexers.filter((x) => x.protocol === 'torrent').length,
      usenet: indexers.filter((x) => x.protocol === 'usenet').length,
      avgResponseMs: 612,
      queries: sum('queries'),
      grabs: sum('grabs'),
      failedQueries: sum('failedQueries'),
      failedGrabs: sum('failedGrabs'),
    },
    indexers,
    applications: [
      { id: 1, name: 'Sonarr', type: 'Sonarr', syncLevel: 'fullSync' },
      { id: 2, name: 'Radarr', type: 'Radarr', syncLevel: 'fullSync' },
    ],
  };
}

function seerr(): SeerrOverview {
  const reqs: [string, SeerrRequest['status'], string, number, number[]?, boolean?][] = [
    ['The Long Winter', 'pending', 'Leo', 40, [2]],
    ['Lanterns Over Kessa', 'pending', 'Priya', 3 * 60],
    ['Copper Valley', 'pending', 'Maya', 7 * 60, [3, 4]],
    ['Iron Bloom', 'approved', 'Jonah', 20 * 60, undefined, true],
    ['Atlas Station', 'completed', 'Maya', 26 * 60, [1]],
    ['Paper Kingdoms', 'completed', 'Leo', 2 * 24 * 60],
    ['Small Hours', 'approved', 'Sam', 3 * 24 * 60],
    ['Low Tide', 'declined', 'Jonah', 4 * 24 * 60, [1]],
  ];
  const list: SeerrRequest[] = reqs.map(([t, status, by, minAgo, seasons, is4k], i) => {
    const x = find(t);
    return {
      id: 500 - i,
      type: x.kind === 'movie' ? 'movie' : 'tv',
      title: x.title,
      year: x.year,
      poster: poster(t),
      backdrop: backdropUrl(t),
      status,
      mediaStatus: status === 'completed' ? 'available' : status === 'approved' ? 'processing' : 'pending',
      is4k: !!is4k,
      seasons: seasons ?? [],
      requestedBy: by,
      modifiedBy: status === 'pending' ? undefined : 'Alex',
      createdAt: iso(minAgo * MIN),
    };
  });
  return {
    counts: { total: 342, movie: 219, tv: 123, pending: 3, approved: 12, declined: 9, processing: 6, available: 312 },
    recent: list,
    pending: list.filter((r) => r.status === 'pending'),
  };
}

function infinidisk(): InfinidiskOverview {
  const drives: InfinidiskOverview['drives'] = [
    { id: 'nvme0', name: 'Cache NVMe', mount: '/mnt/cache', filesystem: 'btrfs', total: 2 * TB, used: 0.64 * TB, free: 1.36 * TB, usage: 0.32, health: 'healthy', temperature: 41, source: 'remote' },
    { id: 'pool-a', name: 'Media Pool A', mount: '/mnt/media/a', filesystem: 'zfs', total: 24 * TB, used: 17.3 * TB, free: 6.7 * TB, usage: 0.72, health: 'healthy', temperature: 36, source: 'remote' },
    { id: 'pool-b', name: 'Media Pool B', mount: '/mnt/media/b', filesystem: 'zfs', total: 24 * TB, used: 21.6 * TB, free: 2.4 * TB, usage: 0.9, health: 'warning', healthDetail: 'Running low on space', temperature: 38, source: 'remote' },
    { id: 'backup', name: 'Backup', mount: '/mnt/backup', filesystem: 'ext4', total: 8 * TB, used: 3.1 * TB, free: 4.9 * TB, usage: 0.39, health: 'healthy', temperature: 33, source: 'remote' },
  ];
  const totals = drives.reduce((a, d) => ({ total: a.total + d.total, used: a.used + d.used, free: a.free + d.free }), { total: 0, used: 0, free: 0 });
  return {
    drives,
    totals: { ...totals, usage: totals.used / totals.total },
    counts: { total: 4, healthy: 3, warning: 1, critical: 0, offline: 0 },
    version: '2.0.0',
    sources: { remote: true, local: 0 },
  };
}

const disabledServices = new Set<ServiceId>();
const autoImport: AutoImportStatus = {
  settings: { enabled: true, intervalMinutes: 15 },
  intervals: [5, 15, 30, 60, 180, 360],
  running: false,
  lastRun: iso(6 * 60_000),
  nextRun: ahead(9 * 60_000),
  stuck: 1,
  log: [
    {
      id: 'demo-1',
      at: iso(2 * HOUR),
      trigger: 'queue',
      instance: 'sonarr',
      title: 'Signal Fire',
      release: 'Signal.Fire.2025.S02E05.Containment.Line.1080p.AMZN.WEB-DL-DEMO',
      outcome: 'imported',
      message: 'Imported 1 of 1 file',
      files: [{ name: 'Signal.Fire.2025.S02E05.Containment.Line.1080p.AMZN.WEB-DL-DEMO.mkv', title: 'Signal Fire', detail: 'S02E05', titleMethod: 'title-match', detailMethod: 'numbering', ok: true }],
    },
    {
      id: 'demo-2',
      at: iso(9 * HOUR),
      trigger: 'schedule',
      instance: 'sonarr',
      title: 'Starfall Academy',
      release: 'Starfall.Academy.Season.1.Complete.1080p.WEB-DEMO',
      outcome: 'imported',
      message: 'Imported 8 of 9 files',
      files: [
        { name: 'Starfall.Academy.S01E01.mkv', title: 'Starfall Academy', detail: 'S01E01', titleMethod: 'grab-history', detailMethod: 'parser', ok: true },
        { name: 'Starfall.Academy.Extras.Featurette.mkv', title: 'Starfall Academy', titleMethod: 'grab-history', ok: false, reason: 'Could not work out which episode(s) this is' },
      ],
    },
    {
      id: 'demo-3',
      at: iso(26 * HOUR),
      trigger: 'schedule',
      instance: 'sonarr',
      title: 'The Cartographers',
      release: 'The.Cartographers.S01E02.720p.HDTV-DEMO',
      outcome: 'skipped',
      message: 'Not an upgrade for existing episode file(s)',
      files: [{ name: 'The.Cartographers.S01E02.720p.HDTV-DEMO.mkv', ok: false, reason: 'Not an upgrade for existing episode file(s)' }],
    },
  ],
};

function settings(): ServiceSettingsView[] {
  const hints: Record<ServiceId, string | undefined> = { jellyfin: '••••7f3a', sonarr: '••••b21c', radarr: '••••9e04', prowlarr: '••••4d18', seerr: '••••0aa9', infinidisk: undefined };
  return (Object.keys(VERSIONS) as ServiceId[]).map((id) => ({
    id,
    name: id === 'infinidisk' ? 'Infinidisk' : id[0]!.toUpperCase() + id.slice(1),
    source: id === 'infinidisk' ? 'environment' : 'database',
    configured: true,
    enabled: !disabledServices.has(id),
    canDisable: id !== 'jellyfin',
    envAvailable: id === 'infinidisk',
    updatedAt: id === 'infinidisk' ? undefined : iso((id.length * 5 + 3) * HOUR),
    updatedBy: id === 'infinidisk' ? undefined : 'Alex',
    url: `https://${id}.example.com`,
    apiKeySet: !!hints[id],
    apiKeyHint: hints[id],
    ...(id === 'infinidisk' ? { authHeader: 'X-Api-Key', statusPath: '/api/v1/status', healthPath: '', mounts: [] } : {}),
  }));
}

/* -------------------------------------------------------------------------- */
/* Server                                                                      */
/* -------------------------------------------------------------------------- */

const app = express();
app.use(express.json());
const json = (fn: () => unknown) => (_req: express.Request, res: express.Response) => res.set('Cache-Control', 'no-store').json(fn());

const demoUser = { id: 'u-alex', name: 'Alex', isAdmin: true, expiresAt: ahead(12 * HOUR) };

app.get('/api/auth/me', json(() => ({ user: demoUser })));
app.post('/api/auth/login', json(() => ({ user: demoUser })));
app.post('/api/auth/logout', json(() => ({ ok: true })));
app.get('/api/auth/server', json(() => ({ name: 'Homelab', version: '10.11.2', online: true, configured: true })));

app.get('/api/config', json(() => ({
  services: Object.fromEntries((Object.keys(VERSIONS) as ServiceId[]).map((k) => [k, !disabledServices.has(k)])),
  enabled: Object.fromEntries((Object.keys(VERSIONS) as ServiceId[]).map((k) => [k, !disabledServices.has(k)])),
  instances: [
    { id: 'sonarr', kind: 'sonarr', name: 'Sonarr', primary: true },
    { id: 'radarr', kind: 'radarr', name: 'Radarr', primary: true },
    { id: 'radarr-4k', kind: 'radarr', name: '4K', primary: false },
  ].filter((i) => !disabledServices.has(i.kind as ServiceId)),
})));
const enabledHealth = () => {
  const h = health();
  const radarr = h.services.find((s) => s.id === 'radarr')!;
  const extra: ServiceHealth = { ...radarr, id: 'radarr-4k', instance: 'radarr-4k', name: 'Radarr · 4K', latencyMs: 83 };
  return { ...h, services: [...h.services, extra].filter((s) => !disabledServices.has(s.kind)) };
};
app.get('/api/health', json(enabledHealth));
app.post('/api/health/recheck', json(enabledHealth));
app.get('/api/system/host', json(host));
app.get('/api/downloads', json(downloads));

app.get('/api/jellyfin/now-playing', json(nowPlaying));
app.get('/api/jellyfin/overview', json(jellyfinOverview));
app.get('/api/jellyfin/latest', json(latest));
app.get('/api/jellyfin/activity', json(activity));
app.get('/api/jellyfin/plays', json(plays));
app.get('/api/sonarr/overview', json(sonarr));
const radarrAutoImport: AutoImportStatus = { ...autoImport, settings: { enabled: false, intervalMinutes: 30 }, nextRun: undefined, stuck: 0, log: [] };
app.get('/api/radarr/auto-import', json(() => radarrAutoImport));
app.put('/api/radarr/auto-import', (req, res) => {
  Object.assign(radarrAutoImport.settings, req.body);
  res.json(radarrAutoImport);
});
app.post('/api/radarr/auto-import/run', (_req, res) => res.json({ results: [], status: radarrAutoImport }));
app.get('/api/settings/instances', json(() => ({
  instances: [{ id: 'radarr-4k', kind: 'radarr', name: '4K', url: 'https://radarr-4k.example.com', enabled: true, apiKeySet: true, apiKeyHint: '••••77ab', createdAt: iso(20 * DAY) }],
})));
app.post('/api/settings/instances/test', (_req, res) => res.json({ ok: true, version: VERSIONS.radarr, latencyMs: 80, issues: [] }));
app.get('/api/sonarr/auto-import', json(() => autoImport));
app.put('/api/sonarr/auto-import', (req, res) => {
  Object.assign(autoImport.settings, req.body);
  autoImport.nextRun = autoImport.settings.enabled ? ahead(autoImport.settings.intervalMinutes * 60_000) : undefined;
  res.json(autoImport);
});
app.post('/api/sonarr/auto-import/run', (req, res) => {
  const entry: AutoImportEntry = {
    id: `demo-${Date.now()}`,
    at: new Date().toISOString(),
    trigger: 'manual',
    instance: 'sonarr',
    title: 'Low Tide',
    release: 'Low.Tide.UK.S03E03.1080p.WEB.H264-DEMO',
    outcome: req.body?.dryRun ? 'preview' : 'imported',
    message: req.body?.dryRun ? 'Would import 1 of 1 file' : 'Imported 1 of 1 file',
    files: [{ name: 'Low.Tide.UK.S03E03.1080p.WEB.H264-DEMO.mkv', title: 'Low Tide', detail: 'S03E03', titleMethod: 'grab-history', detailMethod: 'parser', ok: true }],
  };
  if (!req.body?.dryRun) {
    autoImport.log.unshift(entry);
    autoImport.lastRun = entry.at;
  }
  res.json({ results: [entry], status: autoImport });
});
app.get('/api/radarr/overview', (req, res) => {
  const d = radarr();
  const inst = req.query.instance === 'radarr-4k' ? 'radarr-4k' : 'radarr';
  if (inst === 'radarr') return res.set('Cache-Control', 'no-store').json(d);
  // The 4K instance: same library, a smaller queue.
  const items = d.queue.items.slice(0, 1).map((i) => ({ ...i, instance: inst, instanceName: '4K', quality: 'Remux-2160p' }));
  res.set('Cache-Control', 'no-store').json({ ...d, queue: { total: items.length, items } });
});
app.get('/api/prowlarr/overview', json(prowlarr));
app.get('/api/seerr/overview', json(seerr));
app.get('/api/infinidisk/overview', json(infinidisk));

app.post('/api/:kind/queue/:id/action', (_req, res) => res.json({ ok: true }));
app.get('/api/:kind/missing', (req, res) => {
  const sonarr = req.params.kind === 'sonarr';
  const titles = sonarr ? ['Low Tide', 'Atlas Station', 'Signal Fire', 'Kitchen Brigade'] : ['Small Hours', 'The Last Lighthouse', 'Velvet Static'];
  const items = titles.map((t, i) => ({
    id: i + 1,
    title: t,
    subtitle: sonarr ? `S0${i + 1}E0${i + 2} · Episode ${i + 2}` : String(2023 + i),
    date: iso((i + 1) * 3 * DAY),
    poster: poster(t),
  }));
  res.json({ total: sonarr ? 41 : 17, page: 1, pageSize: 25, items });
});
app.post('/api/:kind/search', (_req, res) => res.json({ ok: true }));
app.post('/api/seerr/requests/:id/:decision', (_req, res) => res.json({ ok: true }));
app.post('/api/jellyfin/sessions/:id/control', (_req, res) => res.json({ ok: true }));
const cleanup: CleanupStatus = {
  settings: { enabled: true, stalledHours: 6, failed: true, action: 'blocklist-search' },
  actions: ['blocklist-search', 'blocklist', 'remove'],
  stallHours: [1, 2, 3, 6, 12, 24, 48],
  available: true,
  lastRun: iso(3 * MIN),
  nextRun: ahead(2 * MIN),
  watching: 6,
  pending: 0,
  log: [
    { id: 'c1', at: iso(5 * HOUR), instance: 'radarr', instanceName: 'Radarr', kind: 'radarr', title: 'Small Hours · 2025', release: 'Small.Hours.2025.1080p.WEB-DEMO', reason: 'No progress for 6 hours', action: 'blocklist-search', outcome: 'done' },
    { id: 'c2', at: iso(30 * HOUR), instance: 'sonarr', instanceName: 'Sonarr', kind: 'sonarr', title: 'Low Tide · S3E2 · Slack Water', release: 'Low.Tide.S03E02.720p-DEMO', reason: 'Download failed: missing articles', action: 'blocklist-search', outcome: 'done' },
  ],
};
app.get('/api/downloads/cleanup', json(() => cleanup));
const notifications: NotificationsStatus = {
  channels: [
    { id: 'n1', type: 'discord', name: 'Discord #homelab', enabled: true, events: ['service_down', 'service_up', 'disk_low', 'import_failed', 'request_pending'], config: {}, secrets: { webhookUrl: 'webhook …8812' } },
    { id: 'n2', type: 'ntfy', name: 'Phone (ntfy)', enabled: true, events: ['service_down', 'disk_low'], config: { server: 'https://ntfy.sh', topic: 'homelab-demo' }, secrets: {} },
  ],
  events: ['service_down', 'service_up', 'disk_low', 'import_done', 'import_failed', 'download_removed', 'request_pending'],
  defaultEvents: ['service_down', 'service_up', 'disk_low', 'import_failed', 'download_removed', 'request_pending'],
  deliveries: [
    { at: iso(5 * HOUR), channel: 'Discord #homelab', event: 'download_removed', title: 'Removed stalled download: Small Hours · 2025', ok: true },
    { at: iso(26 * HOUR), channel: 'Phone (ntfy)', event: 'service_down', title: 'Prowlarr is offline', ok: true },
  ],
  push: { publicKey: 'BDemoKeyNotUsable', devices: 1 },
  publicUrl: 'https://streamforge.example.com',
};
app.get('/api/settings/notifications', json(() => notifications));
app.all('/api/settings/notifications/*rest', (_req, res) => res.json({ ok: true, subscribed: false }));
app.put('/api/downloads/cleanup', (req, res) => {
  Object.assign(cleanup.settings, req.body);
  res.json(cleanup);
});
app.post('/api/downloads/cleanup/run', (_req, res) => res.json({ results: [], status: cleanup }));
app.get('/api/settings/services', json(() => ({ services: settings() })));
app.post('/api/settings/services/:id/test', (req, res) => {
  const id = req.params.id as ServiceId;
  res.json({ ok: true, version: VERSIONS[id], latencyMs: BASE_MS[id] ?? 50, issues: [] });
});
app.put('/api/settings/services/:id', (req, res) => {
  const s = settings().find((x) => x.id === req.params.id);
  res.json({ service: s, signedOut: false });
});
app.put('/api/settings/services/:id/enabled', (req, res) => {
  const id = req.params.id as ServiceId;
  if (req.body?.enabled) disabledServices.delete(id);
  else if (id !== 'jellyfin') disabledServices.add(id);
  res.json({ service: settings().find((x) => x.id === id), signedOut: false });
});
app.delete('/api/settings/services/:id', (req, res) => {
  const s = settings().find((x) => x.id === req.params.id);
  res.json({ service: s, signedOut: false });
});

function sendSvg(res: express.Response, svg: string) {
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }).send(svg);
}
function artFor(key: string, type: string) {
  const t = byTitle.get(key);
  const label = t?.title ?? key.replace(/-/g, ' ');
  if (type === 'Primary') return art(key, 'poster', label, t ? String(t.year) : undefined);
  return art(key, type === 'Thumb' ? 'wide' : 'backdrop');
}
app.get('/api/jellyfin/image/items/:id/:type', (req, res) => {
  const key = String(req.params.id).replace(/-s\d+e\d+$/, '');
  sendSvg(res, artFor(key, String(req.params.type)));
});
app.get('/api/demo/art/:shape/:file', (req, res) => {
  const key = String(req.params.file).replace(/\.svg$/, '');
  sendSvg(res, artFor(key, req.params.shape === 'poster' ? 'Primary' : 'Backdrop'));
});
app.get('/api/jellyfin/image/users/:id', (_req, res) => res.status(404).end());
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

app.listen(PORT, () => {
  console.log(`\n  ▲ StreamForge demo API on http://localhost:${PORT} (fictional data)\n`);
});

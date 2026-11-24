import { db, readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { isConfigured } from '../settings.js';
import { emit } from './notify.js';
import { jf, serverApiKey } from './jellyfin.js';
import { storageForecast } from './storage.js';

/*
 * Weekly digest: what was added to Jellyfin in the last seven days, what got
 * watched, and how storage is doing. Shown on the Digest page to anyone
 * signed in (using their own Jellyfin access, so they only see their
 * libraries), and optionally sent once a week through the notification
 * channels subscribed to "Weekly digest".
 */

const WEEK = 7 * 86_400_000;
const TICKS_PER_MS = 10_000;

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesName?: string;
  SeriesId?: string;
  ProductionYear?: number;
  DateCreated?: string;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string };
  SeriesPrimaryImageTag?: string;
  AlbumArtist?: string;
}

export interface DigestSettings {
  enabled: boolean;
  /** 0 = Sunday. */
  day: number;
  hour: number;
}
const DEFAULTS: DigestSettings = { enabled: false, day: 0, hour: 18 };
let settings: DigestSettings = { ...DEFAULTS, ...readPref<Partial<DigestSettings>>('digest', {}) };
export const digestSettings = () => ({ ...settings, lastSent: readPref<string | null>('digestLastSent', null), canSend: !!serverApiKey() });
export function updateDigest(p: Partial<DigestSettings>) {
  settings = { ...settings, ...p };
  writePref('digest', settings);
  return digestSettings();
}

export interface Who {
  token: string;
  deviceId: string;
  /** With a user, items come from their own view of the libraries. */
  userId?: string;
}

async function added(who: Who, since: number) {
  const res = await jf<{ Items: JfItem[] }>('/Items', who.token, who.deviceId, {
    userId: who.userId,
    Recursive: true,
    IncludeItemTypes: 'Movie,Episode,MusicAlbum,Book,AudioBook',
    MinDateCreated: new Date(since).toISOString(),
    SortBy: 'DateCreated',
    SortOrder: 'Descending',
    Fields: 'DateCreated',
    Limit: 500,
    EnableTotalRecordCount: false,
  });
  const movies: { id: string; title: string; year?: number; image?: string }[] = [];
  const shows = new Map<string, { id: string; title: string; episodes: number; image?: string }>();
  const other: { id: string; title: string; kind: string }[] = [];
  let runtime = 0;
  for (const i of res.Items) {
    runtime += (i.RunTimeTicks ?? 0) / TICKS_PER_MS;
    if (i.Type === 'Movie') {
      movies.push({ id: i.Id, title: i.Name, year: i.ProductionYear, image: i.ImageTags?.Primary ? `/api/jellyfin/image/items/${i.Id}/Primary?w=200&tag=${i.ImageTags.Primary}` : undefined });
    } else if (i.Type === 'Episode' && i.SeriesId) {
      const s = shows.get(i.SeriesId) ?? {
        id: i.SeriesId,
        title: i.SeriesName ?? 'Unknown series',
        episodes: 0,
        image: i.SeriesPrimaryImageTag ? `/api/jellyfin/image/items/${i.SeriesId}/Primary?w=200&tag=${i.SeriesPrimaryImageTag}` : undefined,
      };
      s.episodes++;
      shows.set(i.SeriesId, s);
    } else {
      other.push({ id: i.Id, title: i.AlbumArtist ? `${i.AlbumArtist} – ${i.Name}` : i.Name, kind: i.Type === 'MusicAlbum' ? 'Album' : 'Book' });
    }
  }
  return { movies, shows: [...shows.values()].sort((a, b) => b.episodes - a.episodes), other, runtimeMs: runtime };
}

function watched(since: number) {
  const rows = db
    .prepare('SELECT user_name, title, series, watched_ms FROM plays WHERE started_at >= ? AND watched_ms >= 60000')
    .all(since) as { user_name: string | null; title: string; series: string | null; watched_ms: number }[];
  const titles = new Map<string, { title: string; plays: number }>();
  const viewers = new Set<string>();
  let ms = 0;
  for (const r of rows) {
    ms += r.watched_ms;
    if (r.user_name) viewers.add(r.user_name);
    const k = r.series ?? r.title;
    const t = titles.get(k) ?? { title: k, plays: 0 };
    t.plays++;
    titles.set(k, t);
  }
  return { plays: rows.length, watchedMs: ms, viewers: viewers.size, top: [...titles.values()].sort((a, b) => b.plays - a.plays).slice(0, 5) };
}

function storage() {
  const vols = storageForecast().volumes;
  const soonest = vols.filter((v) => v.daysLeft !== undefined).sort((a, b) => a.daysLeft! - b.daysLeft!)[0];
  const used = vols.reduce((n, v) => n + v.used, 0);
  const total = vols.reduce((n, v) => n + v.total, 0);
  return { used, total, soonest: soonest ? { label: soonest.label, daysLeft: soonest.daysLeft! } : undefined };
}

export async function buildDigest(who: Who) {
  const now = Date.now();
  const since = now - WEEK;
  return cache.get(`jf:digest:${who.userId ?? 'server'}`, 10 * 60_000, async () => ({
    from: new Date(since).toISOString(),
    to: new Date(now).toISOString(),
    added: await added(who, since),
    watched: watched(since),
    storage: storage(),
  }));
}

const gb = (n: number) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : `${Math.round(n / 1024 ** 3)} GB`);
const list = (xs: string[], max = 8) => (xs.length > max ? `${xs.slice(0, max).join(', ')} and ${xs.length - max} more` : xs.join(', '));

/** Plain-text summary for notification channels. */
export function digestText(d: Awaited<ReturnType<typeof buildDigest>>) {
  const lines: string[] = [];
  const { movies, shows, other } = d.added;
  if (!movies.length && !shows.length && !other.length) lines.push('Nothing new was added this week.');
  if (movies.length) lines.push(`🎬 ${movies.length} new movie${movies.length === 1 ? '' : 's'}: ${list(movies.map((m) => (m.year ? `${m.title} (${m.year})` : m.title)))}`);
  if (shows.length) lines.push(`📺 New episodes of ${shows.length} show${shows.length === 1 ? '' : 's'}: ${list(shows.map((s) => `${s.title}${s.episodes > 1 ? ` (${s.episodes})` : ''}`))}`);
  if (other.length) lines.push(`🎵 ${other.length} new album${other.length === 1 ? '' : 's'} and book${other.length === 1 ? '' : 's'}`);
  if (d.watched.plays) {
    lines.push(`▶️ ${d.watched.plays} plays, ${Math.round(d.watched.watchedMs / 3_600_000)} hours watched by ${d.watched.viewers} ${d.watched.viewers === 1 ? 'person' : 'people'}.`);
    if (d.watched.top[0]) lines.push(`Most watched: ${d.watched.top.slice(0, 3).map((t) => t.title).join(', ')}`);
  }
  if (d.storage.total) lines.push(`💾 ${gb(d.storage.used)} of ${gb(d.storage.total)} used${d.storage.soonest ? `; ${d.storage.soonest.label} full in about ${d.storage.soonest.daysLeft} days` : ''}.`);
  return lines.join('\n');
}

export async function sendDigest() {
  const key = serverApiKey();
  if (!key) throw new Error('The weekly digest needs a Jellyfin API key (Settings → Jellyfin).');
  cache.delete('jf:digest:server');
  const d = await buildDigest({ token: key, deviceId: 'streamforge-server' });
  const count = d.added.movies.length + d.added.shows.length + d.added.other.length;
  emit('weekly_digest', { title: count ? `This week: ${count} new title${count === 1 ? '' : 's'}` : 'Your weekly StreamForge digest', message: digestText(d), url: '/digest' });
  writePref('digestLastSent', new Date().toISOString());
  return d;
}

function due(now = new Date()) {
  if (!settings.enabled || !isConfigured('jellyfin')) return false;
  if (now.getDay() !== settings.day || now.getHours() !== settings.hour) return false;
  const last = readPref<string | null>('digestLastSent', null);
  return !last || now.getTime() - Date.parse(last) > 2 * 86_400_000;
}

export function startDigest() {
  setInterval(() => {
    if (due()) void sendDigest().catch((err) => console.warn(`[digest] ${(err as Error).message}`));
  }, 5 * 60_000).unref();
}

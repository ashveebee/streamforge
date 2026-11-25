import { db } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { isConfigured } from '../settings.js';
import { jf, type JfCtx } from './jellyfin.js';
import { mainEmby, mainPlex } from './mainServer.js';
import { remote } from './jellyfin.js';
import * as plex from './plex.js';
import { userRequests } from './seerr.js';

/* The signed-in user's own activity: what to watch next, history and requests. */

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesName?: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProductionYear?: number;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string; Thumb?: string };
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  SeriesThumbImageTag?: string;
  UserData?: { PlayedPercentage?: number; PlaybackPositionTicks?: number; LastPlayedDate?: string };
}

const TICKS_PER_MS = 10_000;

function card(i: JfItem) {
  // Prefer a landscape image: the item's backdrop, then its series'.
  const backdrop = i.BackdropImageTags?.[0]
    ? { itemId: i.Id, type: 'Backdrop' as const, tag: i.BackdropImageTags[0] }
    : i.ParentBackdropItemId && i.ParentBackdropImageTags?.[0]
      ? { itemId: i.ParentBackdropItemId, type: 'Backdrop' as const, tag: i.ParentBackdropImageTags[0] }
      : i.ImageTags?.Thumb
        ? { itemId: i.Id, type: 'Thumb' as const, tag: i.ImageTags.Thumb }
        : i.ParentThumbItemId && i.ParentThumbImageTag
          ? { itemId: i.ParentThumbItemId, type: 'Thumb' as const, tag: i.ParentThumbImageTag }
          : i.ImageTags?.Primary
            ? { itemId: i.Id, type: 'Primary' as const, tag: i.ImageTags.Primary }
            : undefined;
  const ep = i.Type === 'Episode' && i.ParentIndexNumber !== undefined && i.IndexNumber !== undefined ? `S${String(i.ParentIndexNumber).padStart(2, '0')}E${String(i.IndexNumber).padStart(2, '0')}` : undefined;
  const runtime = i.RunTimeTicks ? i.RunTimeTicks / TICKS_PER_MS : undefined;
  const position = i.UserData?.PlaybackPositionTicks ? i.UserData.PlaybackPositionTicks / TICKS_PER_MS : undefined;
  return {
    id: i.Id,
    title: i.Type === 'Episode' ? (i.SeriesName ?? i.Name) : i.Name,
    subtitle: i.Type === 'Episode' ? [ep, i.Name].filter(Boolean).join(' · ') : i.ProductionYear ? String(i.ProductionYear) : undefined,
    progress: i.UserData?.PlayedPercentage !== undefined ? i.UserData.PlayedPercentage / 100 : undefined,
    remainingMs: runtime && position ? Math.max(0, runtime - position) : undefined,
    lastPlayed: i.UserData?.LastPlayedDate,
    image: backdrop,
  };
}

const FIELDS = 'PrimaryImageAspectRatio,ParentBackdropItemId,ParentBackdropImageTags,BackdropImageTags';

/** Continue watching and next up: from Plex's On Deck when Plex is the sign-in server. */
async function upNext(ctx: JfCtx, serverToken?: string) {
  const p = mainPlex();
  if (p) return plex.onDeck(p, ctx.userId, serverToken).catch(() => ({ resume: [], nextUp: [] }));
  // Emby speaks Jellyfin's API: the same calls, with the user's own Emby token.
  const e = mainEmby();
  if (e) {
    const as = { ...e, apiKey: ctx.token };
    const [resume, nextUp] = await Promise.all([
      cache.get(`jfx:${e.id}:resume:${ctx.userId}`, 30_000, () =>
        remote<{ Items: JfItem[] }>(as, `/Users/${ctx.userId}/Items/Resume`, { Limit: 12, MediaTypes: 'Video', Fields: FIELDS, EnableImageTypes: 'Primary,Backdrop,Thumb' }),
      ).catch(() => ({ Items: [] as JfItem[] })),
      cache.get(`jfx:${e.id}:nextup:${ctx.userId}`, 60_000, () =>
        remote<{ Items: JfItem[] }>(as, '/Shows/NextUp', { UserId: ctx.userId, Limit: 12, Fields: FIELDS, EnableImageTypes: 'Primary,Backdrop,Thumb' }),
      ).catch(() => ({ Items: [] as JfItem[] })),
    ]);
    const onEmby = (c: ReturnType<typeof card>) => ({ ...c, image: c.image && { ...c.image, server: e.id } });
    return { resume: (resume.Items ?? []).map(card).map(onEmby), nextUp: (nextUp.Items ?? []).map(card).map(onEmby) };
  }
  const [resume, nextUp] = await Promise.all([
    cache.get(`jf:resume:${ctx.userId}`, 30_000, () =>
      jf<{ Items: JfItem[] }>(`/Users/${ctx.userId}/Items/Resume`, ctx.token, ctx.deviceId, { Limit: 12, MediaTypes: 'Video', Fields: FIELDS, EnableImageTypes: 'Primary,Backdrop,Thumb' }),
    ).catch(() => ({ Items: [] })),
    cache.get(`jf:nextup:${ctx.userId}`, 60_000, () =>
      jf<{ Items: JfItem[] }>('/Shows/NextUp', ctx.token, ctx.deviceId, { UserId: ctx.userId, Limit: 12, Fields: FIELDS, EnableImageTypes: 'Primary,Backdrop,Thumb' }),
    ).catch(() => ({ Items: [] })),
  ]);
  return { resume: (resume.Items ?? []).map(card), nextUp: (nextUp.Items ?? []).map(card) };
}

export async function myOverview(ctx: JfCtx, serverToken?: string, userName = '') {
  const { resume, nextUp } = await upNext(ctx, serverToken);

  // History comes from StreamForge's own recorder (needs a Jellyfin API key).
  const since = Date.now() - 30 * 86_400_000;
  const rows = db
    // Plays on other servers carry that server's user id, so the user's name matches them too.
    .prepare('SELECT title, series, type, client, device, method, started_at, watched_ms, server_name FROM plays WHERE user_id = ? OR (user_name IS NOT NULL AND lower(user_name) = lower(?)) ORDER BY started_at DESC LIMIT 40')
    .all(ctx.userId, userName) as { title: string; series: string | null; type: string | null; client: string | null; device: string | null; method: string; started_at: number; watched_ms: number; server_name: string | null }[];
  const month = db
    .prepare('SELECT COUNT(*) AS plays, COALESCE(SUM(watched_ms), 0) AS ms FROM plays WHERE (user_id = ? OR (user_name IS NOT NULL AND lower(user_name) = lower(?))) AND started_at >= ? AND watched_ms >= 60000')
    .get(ctx.userId, userName, since) as {
    plays: number;
    ms: number;
  };

  return {
    resume,
    nextUp,
    history: rows
      .filter((r) => r.watched_ms >= 60_000)
      .map((r) => ({
        title: r.series ?? r.title,
        subtitle: r.series ? r.title : undefined,
        client: [r.client, r.device, r.server_name].filter(Boolean).join(' · ') || undefined,
        transcoded: r.method === 'Transcode',
        at: new Date(r.started_at).toISOString(),
        watchedMs: r.watched_ms,
      })),
    month: { plays: month.plays, watchedMs: month.ms },
    requestsAvailable: isConfigured('seerr'),
  };
}

export async function myRequests(ctx: JfCtx) {
  if (!isConfigured('seerr')) return { linked: false, requests: [] };
  return userRequests(ctx.userId);
}

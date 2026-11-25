import type { Request, Response } from 'express';
import { Router } from 'express';
import { audit, auditEntries } from './lib/audit.js';
import { z } from 'zod';
import { handle, HttpError, pipeImage } from './lib/handle.js';
import { CLEANUP_ACTIONS, cleanupStatus, runCleanup, STALL_HOURS, updateCleanup, type CleanupAction } from './services/cleanup.js';
import { arrRouter } from './arrRoutes.js';
import { clientRouter } from './clientRoutes.js';
import { ctxOf, requireAdmin, requireAuth } from './auth.js';
import { allowedAreas, canSee, requireArea } from './access.js';
import { downloadSnapshot, healthSnapshot, recheck } from './health.js';
import { isConfigured, isEnabled, SERVICE_IDS } from './settings.js';
import { hasClients } from './services/clients/index.js';
import { settingsRouter } from './settingsRoutes.js';
import { moonfinClientConfig } from './services/moonfin.js';
import { hostSnapshot } from './host.js';
import * as jellyfin from './services/jellyfin.js';
import { anyInstance, arrInstances } from './services/instances.js';
import { mediaServer, mediaServers, type MediaServer } from './services/mediaServers.js';
import * as plex from './services/plex.js';
import { kometaStatus } from './services/kometa.js';
import { mainEmby, mainExtra, mainPlex, mainType, mediaReady, notJellyfinMain } from './services/mainServer.js';
import { sessions } from './lib/sessions.js';
import { playbackStats } from './services/playStats.js';
import { keepItem, reclaim, reclaimSuggestions, UNWATCHED_DAYS } from './services/reclaim.js';
import { buildDigest, digestSettings, sendDigest, updateDigest } from './services/digest.js';
import { ACTION_TYPES, CONDITION_TYPES, removeRule, RuleError, rulesStatus, runRule, saveRule } from './services/rules.js';
import { arrTitleSearch, jellyfinEpisodes, jellyfinMedia, mediaDetails, seasonEpisodes } from './services/media.js';
import { myOverview, myRequests } from './services/me.js';
import { addToArr, requestMedia, search } from './services/search.js';
import { guardStatus, updateGuard } from './services/playbackGuard.js';
import { scanAll, scanLibrary, scheduledTasks, startTask, stopTask, TASK_ID_RE } from './services/jellyfinTasks.js';
import { libraryHealth } from './services/libraryHealth.js';
import { checkNow, updateStatus } from './services/updates.js';
import { deviceReport, PlayabilityError, playabilityStatus, titlePlayability } from './services/playability/index.js';
import { DiagnosisError, diagnosisStatus, explain, updateDiagnosisPrefs } from './services/diagnosis/index.js';
import { setAlertPercent, storageForecast } from './services/storage.js';
import { prowlarrOverview } from './services/prowlarr.js';
import { decideRequest, seerrOverview } from './services/seerr.js';
import { infinidiskOverview } from './services/infinidisk.js';
import { bazarrOverview, bazarrSearch } from './services/bazarr.js';
import { musicMissing, musicOverview, musicQueueRemove, musicSearch, type BookOrMusic } from './services/music.js';

export const api = Router();
api.use(requireAuth);
api.use(requireArea);

/* --------------------------------- core --------------------------------- */

api.get('/config', (req, res) => {
  res.json({
    // Sonarr/Radarr count as configured when any instance is set up.
    services: Object.fromEntries(
      // `jellyfin` stands for the media server area: true with Plex as the sign-in server too.
      SERVICE_IDS.map((id) => [id, canSee(req, id) && (id === 'sonarr' || id === 'radarr' ? anyInstance(id) : id === 'jellyfin' ? mediaReady() : isConfigured(id))]),
    ),
    // A service the user can't see counts as switched off for them.
    enabled: Object.fromEntries(SERVICE_IDS.map((id) => [id, isEnabled(id) && canSee(req, id)])),
    instances: arrInstances()
      .filter((i) => canSee(req, i.kind))
      .map((i) => ({ id: i.id, kind: i.kind, name: i.name, primary: i.primary })),
    /** Media servers (Jellyfin, Emby, Plex), the main one first and marked `primary`. */
    jellyfinServers: canSee(req, 'jellyfin') ? mediaServerList() : [],
    /** Which kind of server people sign in with; its data backs the dashboard, stats and your page. */
    mainServer: mainType(),
    /** Areas this user can open; null means everything (admins). */
    access: allowedAreas(req) ? [...allowedAreas(req)!] : null,
    downloadClients: hasClients() && canSee(req, 'downloads'),
    /** Set when Moonfin is switched on: where to open titles. */
    moonfin: moonfinClientConfig(),
  });
});
api.get('/health', (req, res) => res.set('Cache-Control', 'no-store').json(healthSnapshot((kind) => canSee(req, kind))));
api.post('/health/recheck', handle(null, async (req) => {
  await recheck();
  return healthSnapshot((kind) => canSee(req, kind));
}));
api.get('/system/host', (_req, res) => res.set('Cache-Control', 'no-store').json(hostSnapshot()));
api.get('/downloads', (_req, res) => res.set('Cache-Control', 'no-store').json(downloadSnapshot()));
api.get('/library/health', handle(null, (req) => libraryHealth(ctxOf(req.session!))));
api.get(
  '/library/reclaim',
  handle('jellyfin', (req) => {
    const d = Number(req.query.days);
    return reclaimSuggestions(ctxOf(req.session!), (UNWATCHED_DAYS as readonly number[]).includes(d) ? d : 365);
  }),
);
const reclaimBody = z
  .object({ kind: z.enum(['movie', 'series']), instance: z.string().max(64), id: z.number().int().positive(), action: z.enum(['delete', 'unmonitor', 'keep', 'unkeep']) })
  .strict();
api.post(
  '/library/reclaim',
  requireAdmin,
  handle(null, async (req) => {
    const b = reclaimBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid request');
    const { kind, instance, id, action } = b.data;
    if (action === 'keep' || action === 'unkeep') {
      keepItem(`${instance}:${kind}:${id}`, action === 'keep');
      return { ok: true };
    }
    const r = await reclaim(kind, instance, id, action);
    audit(req, `[library] ${action === 'delete' ? 'deleted' : 'unmonitored'} ${kind} “${r.title}” in ${r.instance}${action === 'delete' ? ' (files removed)' : ''}`);
    return { ok: true };
  }),
);
api.get('/storage/forecast', (_req, res) => res.set('Cache-Control', 'no-store').json(storageForecast()));
api.put(
  '/storage/alert',
  requireAdmin,
  handle(null, async (req) => {
    const p = Number((req.body as { percent?: unknown } | undefined)?.percent);
    if (!Number.isInteger(p) || p < 50 || p > 99) throw new HttpError(400, 'Pick a value between 50 and 99%');
    audit(req, `[storage] disk alert threshold set to ${p}%`);
    return setAlertPercent(p);
  }),
);

/* Stalled/failed download cleanup across every Sonarr/Radarr instance. */
const cleanupPatch = z
  .object({
    enabled: z.boolean().optional(),
    stalledHours: z.number().refine((n) => (STALL_HOURS as readonly number[]).includes(n), 'Unsupported period').optional(),
    failed: z.boolean().optional(),
    action: z.enum(CLEANUP_ACTIONS as [CleanupAction, ...CleanupAction[]]).optional(),
  })
  .strict();
api.get('/downloads/cleanup', (_req, res) => res.set('Cache-Control', 'no-store').json(cleanupStatus()));
api.put(
  '/downloads/cleanup',
  requireAdmin,
  handle(null, async (req) => {
    const r = cleanupPatch.safeParse(req.body ?? {});
    if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid settings');
    audit(req, `[cleanup] settings changed: ${JSON.stringify(r.data)}`);
    return updateCleanup(r.data);
  }),
);
api.post(
  '/downloads/cleanup/run',
  requireAdmin,
  handle(null, async (req) => {
    const dryRun = (req.body as { dryRun?: unknown } | undefined)?.dryRun === true;
    if (!dryRun) audit(req, '[cleanup] run manually');
    const results = await runCleanup({ dryRun });
    return { results, status: cleanupStatus() };
  }),
);

/* --------------------------------- kometa -------------------------------- */

api.get('/kometa/status', (_req, res) => res.set('Cache-Control', 'no-store').json(kometaStatus()));

/* -------------------------------- jellyfin ------------------------------ */

/** The main server's name as Jellyfin reports it, for tabs and labels. */
function mainServerName() {
  const meta = healthSnapshot().services.find((s) => s.id === 'jellyfin')?.meta;
  const name = meta && typeof meta.server === 'string' ? meta.server : undefined;
  return name || 'Main server';
}

/** Every media server, main one first. Empty when the main Jellyfin server is the only one. */
function mediaServerList() {
  const main = mainExtra();
  const rest = mediaServers()
    .filter((s) => s.id !== main?.id)
    .map((s) => ({ id: s.id, type: s.type, name: s.name, primary: false }));
  if (main) return [{ id: main.id, type: main.type, name: main.name, primary: true }, ...rest];
  return rest.length ? [{ id: 'jellyfin', type: 'jellyfin' as const, name: mainServerName(), primary: true }, ...rest] : [];
}

/**
 * The media server a request addresses with `instance` (query or body). With
 * none given, the main server: undefined for the main Jellyfin server, or the
 * main Plex or Emby server when that is the sign-in server.
 */
function extraServer(req: Request): MediaServer | undefined {
  const raw = (req.body as { instance?: unknown } | undefined)?.instance ?? req.query.instance ?? req.query.server;
  if (typeof raw !== 'string' || !raw || raw === 'jellyfin') return raw === 'jellyfin' ? undefined : mainExtra();
  const srv = mediaServer(raw);
  if (!srv) throw new HttpError(404, 'Unknown media server', 'not_found');
  return srv;
}

/** Jellyfin-only features (title pages, scheduled tasks) answer this when Plex or Emby is the sign-in server. */
function needJellyfin() {
  if (notJellyfinMain() && !isConfigured('jellyfin')) throw new HttpError(404, 'This needs a Jellyfin server.', 'not_configured');
}

/* Calls for an extra server, by type. Emby speaks Jellyfin's API. */
const remoteNowPlaying = (srv: MediaServer) => (srv.type === 'plex' ? plex.nowPlaying(srv) : jellyfin.remoteNowPlaying(srv));
const remoteOverview = (srv: MediaServer) => (srv.type === 'plex' ? plex.overview(srv) : jellyfin.remoteOverview(srv));
const remoteLatest = (srv: MediaServer) => (srv.type === 'plex' ? plex.latest(srv) : jellyfin.remoteLatest(srv));
const remoteActivity = (srv: MediaServer) => (srv.type === 'plex' ? plex.activity(srv) : jellyfin.remoteActivity(srv));

/* Streams from the main server and every extra one. An extra server that's down doesn't hide the rest. */
api.get(
  '/jellyfin/now-playing',
  handle('jellyfin', async (req) => {
    const extras = mediaServers();
    const [main, ...rest] = await Promise.allSettled([
      isConfigured('jellyfin') ? jellyfin.nowPlaying(ctxOf(req.session!)) : Promise.resolve([] as jellyfin.NowPlaying[]),
      ...extras.map(remoteNowPlaying),
    ]);
    if (main!.status === 'rejected' && (!extras.length || rest.every((r) => r.status === 'rejected'))) throw main!.reason;
    const streams = [
      ...(main!.status === 'fulfilled' ? main!.value : []),
      ...rest.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
    ];
    return streams.sort((a, b) => Number(a.state.isPaused) - Number(b.state.isPaused));
  }),
);
api.get(
  '/jellyfin/overview',
  handle('jellyfin', (req) => {
    const srv = extraServer(req);
    return srv ? remoteOverview(srv) : jellyfin.overview(ctxOf(req.session!));
  }),
);
api.get(
  '/jellyfin/latest',
  handle('jellyfin', (req) => {
    const srv = extraServer(req);
    return srv ? remoteLatest(srv) : jellyfin.latest(ctxOf(req.session!));
  }),
);
api.get(
  '/jellyfin/activity',
  handle('jellyfin', (req) => {
    const srv = extraServer(req);
    return srv ? remoteActivity(srv) : jellyfin.activity(ctxOf(req.session!));
  }),
);
api.get(
  '/jellyfin/plays',
  handle('jellyfin', (req) => {
    const p = mainPlex();
    const e = mainEmby();
    return p ? plex.playsPerDay(p) : e ? jellyfin.remotePlaybackHistory(e) : jellyfin.playbackHistory(ctxOf(req.session!));
  }),
);
api.get(
  '/jellyfin/stats',
  handle('jellyfin', (req) => {
    const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    return playbackStats(ctxOf(req.session!), days);
  }),
);

const sessionBody = z
  .object({
    command: z.enum(['pause', 'unpause', 'stop', 'message']),
    text: z.string().trim().max(500).optional(),
    /** An extra media server's id, for streams playing there. */
    instance: z.string().max(64).optional(),
  })
  .strict();
api.post(
  '/jellyfin/sessions/:id/control',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const id = String(req.params.id);
    const b = sessionBody.safeParse(req.body ?? {});
    if (!jellyfin.SESSION_ID_RE.test(id) || !b.success) throw new HttpError(400, 'Invalid request');
    if (b.data.command === 'message' && !b.data.text) throw new HttpError(400, 'Enter a message');
    const srv = extraServer(req);
    const tag = srv ? srv.type : 'jellyfin';
    if (srv?.type === 'plex') {
      // Plex can only end streams from the server; the reason is shown to the viewer.
      if (b.data.command !== 'stop') throw new HttpError(400, 'Plex can only stop streams, not pause them or send messages.');
      await plex.stopSession(srv, id, b.data.text);
    } else {
      const send = (command: jellyfin.SessionCommand, text?: string) =>
        srv ? jellyfin.controlRemoteSession(srv, id, command, text) : jellyfin.controlSession(ctxOf(req.session!), id, command, text);
      // A stop can carry a message explaining why, shown before playback ends.
      if (b.data.command === 'stop' && b.data.text) await send('message', b.data.text);
      await send(b.data.command, b.data.text);
    }
    audit(req, `[${tag}] stream ${id}${srv ? ` on ${srv.name}` : ''}: ${b.data.command}${b.data.text ? ` (“${b.data.text}”)` : ''}`);
    return { ok: true };
  }),
);

/* Transcode and bandwidth alerts. */
api.get('/jellyfin/guard', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(guardStatus()));
const guardBody = z
  .object({
    enabled: z.boolean().optional(),
    maxTranscodes: z.number().int().min(0).max(50).optional(),
    fourK: z.enum(['off', 'alert', 'message']).optional(),
    maxMbps: z.number().int().min(0).max(100_000).optional(),
    message: z.string().trim().min(1).max(400).optional(),
  })
  .strict();
api.put(
  '/jellyfin/guard',
  requireAdmin,
  handle(null, async (req) => {
    const b = guardBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid settings');
    audit(req, `[jellyfin] playback alerts changed: ${JSON.stringify(b.data)}`);
    return updateGuard(b.data);
  }),
);

/* Scheduled tasks and library scans (admins). */
api.get(
  '/jellyfin/tasks',
  requireAdmin,
  handle('jellyfin', (req) => {
    needJellyfin();
    return scheduledTasks(ctxOf(req.session!));
  }),
);
api.post(
  '/jellyfin/tasks/:id/:op',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const id = String(req.params.id);
    const op = String(req.params.op);
    if (!TASK_ID_RE.test(id) || (op !== 'start' && op !== 'stop')) throw new HttpError(400, 'Invalid request');
    const name = typeof (req.body as { name?: unknown } | undefined)?.name === 'string' ? String((req.body as { name: string }).name).slice(0, 120) : id;
    await (op === 'start' ? startTask : stopTask)(ctxOf(req.session!), id);
    audit(req, `[jellyfin] task “${name}” ${op === 'start' ? 'started' : 'stopped'}`);
    return { ok: true };
  }),
);
api.post(
  '/jellyfin/scan',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const b = z
      .object({ library: z.string().max(64).optional(), name: z.string().max(120).optional(), full: z.boolean().optional(), instance: z.string().max(64).optional() })
      .strict()
      .safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid request');
    const srv = extraServer(req);
    if (srv?.type === 'plex') await plex.scan(srv, b.data.library, !!b.data.full);
    else if (srv) await jellyfin.remoteScan(srv, b.data.library, !!b.data.full);
    else {
      if (b.data.library && !jellyfin.isValidId(b.data.library)) throw new HttpError(400, 'Invalid request');
      if (b.data.library) await scanLibrary(ctxOf(req.session!), b.data.library, !!b.data.full);
      else await scanAll(ctxOf(req.session!));
    }
    audit(req, `[${srv ? srv.type : 'jellyfin'}] ${b.data.full ? 'metadata refresh' : 'library scan'}: ${b.data.library ? (b.data.name ?? b.data.library) : 'all libraries'}${srv ? ` on ${srv.name}` : ''}`);
    return { ok: true };
  }),
);

function imageOpts(req: Request) {
  const tag = typeof req.query.tag === 'string' && /^[\w-]{1,64}$/.test(req.query.tag) ? req.query.tag : undefined;
  const w = Number(req.query.w);
  return { tag, maxWidth: Number.isFinite(w) && w > 0 ? Math.min(Math.round(w), 2400) : undefined };
}

/** The extra server an image lives on (`?server=`); null after answering 404 for an unknown one. */
function imageServer(req: Request, res: Response): MediaServer | undefined | null {
  try {
    return extraServer(req);
  } catch {
    res.status(404).end();
    return null;
  }
}

api.get('/jellyfin/image/items/:id/:type', (req, res) => {
  const id = String(req.params.id);
  const type = String(req.params.type);
  const srv = imageServer(req, res);
  if (srv === null) return;
  const validId = !srv ? jellyfin.isValidId(id) : srv.type === 'plex' ? plex.isValidId(id) : jellyfin.isValidRemoteId(id);
  if (!validId || !jellyfin.isValidImageType(type)) {
    res.status(400).end();
    return;
  }
  const opts = imageOpts(req);
  void pipeImage(
    res,
    !srv
      ? jellyfin.image(ctxOf(req.session!), 'Items', id, type, opts)
      : srv.type === 'plex'
        ? plex.image(srv, id, type, opts)
        : jellyfin.remoteImage(srv, 'Items', id, type, opts),
  );
});

api.get('/jellyfin/image/users/:id', (req, res) => {
  const id = String(req.params.id);
  const srv = imageServer(req, res);
  if (srv === null) return;
  // Plex avatars live on plex.tv; they're proxied from addresses Plex gave us.
  if (srv?.type === 'plex') {
    if (!/^\d{1,12}$/.test(id)) {
      res.status(400).end();
      return;
    }
    void pipeImage(res, plex.avatar(id, sessions.forUser(id)[0]?.avatarUrl));
    return;
  }
  if (!jellyfin.isValidId(id)) {
    res.status(400).end();
    return;
  }
  void pipeImage(res, srv ? jellyfin.remoteImage(srv, 'Users', id, 'Primary', imageOpts(req)) : jellyfin.image(ctxOf(req.session!), 'Users', id, 'Primary', imageOpts(req)));
});

/* ---------------------------------- arr --------------------------------- */

api.use(arrRouter);
api.use(clientRouter);
api.get('/prowlarr/overview', handle('prowlarr', () => prowlarrOverview()));
api.get('/seerr/overview', handle('seerr', () => seerrOverview()));
api.post(
  '/seerr/requests/:id/:decision',
  requireAdmin,
  handle('seerr', async (req) => {
    const id = Number(req.params.id);
    const decision = String(req.params.decision);
    if (!Number.isInteger(id) || id <= 0 || (decision !== 'approve' && decision !== 'decline')) throw new HttpError(400, 'Invalid request');
    await decideRequest(id, decision);
    audit(req, `[seerr] request #${id} ${decision}d`);
    return { ok: true };
  }),
);
api.get('/infinidisk/overview', handle('infinidisk', () => infinidiskOverview()));

/* --------------------------- bazarr, lidarr, readarr --------------------------- */

api.get('/bazarr/overview', handle('bazarr', () => bazarrOverview()));
const bazarrSearchBody = z
  .object({ seriesId: z.number().int().positive().optional(), movieId: z.number().int().positive().optional(), all: z.enum(['episodes', 'movies']).optional() })
  .strict()
  .refine((b) => [b.seriesId, b.movieId, b.all].filter((x) => x !== undefined).length === 1, 'Pick one thing to search for');
api.post(
  '/bazarr/search',
  requireAdmin,
  handle('bazarr', async (req) => {
    const b = bazarrSearchBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid request');
    audit(req, `[bazarr] subtitle search: ${b.data.all ? `all missing ${b.data.all}` : b.data.seriesId ? `series ${b.data.seriesId}` : `movie ${b.data.movieId}`}`);
    return bazarrSearch(b.data);
  }),
);

for (const kind of ['lidarr', 'readarr'] as BookOrMusic[]) {
  api.get(`/${kind}/overview`, handle(kind, () => musicOverview(kind)));
  api.get(`/${kind}/missing`, handle(kind, (req) => musicMissing(kind, Math.max(1, Math.min(10_000, Number(req.query.page) || 1)))));
  api.post(
    `/${kind}/search`,
    requireAdmin,
    handle(kind, async (req) => {
      const b = z.object({ ids: z.array(z.number().int().positive()).max(100).default([]) }).strict().safeParse(req.body ?? {});
      if (!b.success) throw new HttpError(400, 'Invalid request');
      audit(req, `[search] ${kind}: ${b.data.ids.length ? `${b.data.ids.length} item(s)` : 'all missing'}`);
      return musicSearch(kind, b.data.ids);
    }),
  );
  api.post(
    `/${kind}/queue/:id/remove`,
    requireAdmin,
    handle(kind, async (req) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid queue id');
      const blocklist = (req.body as { blocklist?: unknown } | undefined)?.blocklist === true;
      await musicQueueRemove(kind, id, blocklist);
      audit(req, `[queue] ${kind} #${id}: remove${blocklist ? ' + blocklist' : ''}`);
      return { ok: true };
    }),
  );
}

/* --------------------------------- media -------------------------------- */

/* Title details. Open to every signed-in user; each section respects access. */
api.get(
  '/media/jellyfin/:id',
  handle('jellyfin', async (req) => {
    needJellyfin();
    const id = String(req.params.id);
    if (!jellyfin.isValidId(id)) throw new HttpError(400, 'Invalid id');
    return jellyfinMedia(ctxOf(req.session!), id, !!req.session!.isAdmin);
  }),
);
api.get(
  '/media/jellyfin/:id/seasons/:season/episodes',
  handle('jellyfin', async (req) => {
    needJellyfin();
    const id = String(req.params.id);
    const season = String(req.params.season);
    if (!jellyfin.isValidId(id) || !jellyfin.isValidId(season)) throw new HttpError(400, 'Invalid id');
    return jellyfinEpisodes(ctxOf(req.session!), id, season, !!req.session!.isAdmin);
  }),
);
api.get(
  '/media/tv/:tmdbId/seasons/:season',
  handle(null, async (req) => {
    const tmdbId = Number(req.params.tmdbId);
    const season = Number(req.params.season);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !Number.isInteger(season) || season < 0 || season > 1000) throw new HttpError(400, 'Invalid season');
    return seasonEpisodes(ctxOf(req.session!), tmdbId, season, { isAdmin: !!req.session!.isAdmin, can: (a) => canSee(req, a as never) });
  }),
);
api.get(
  '/media/:type/:tmdbId',
  handle(null, async (req) => {
    const type = String(req.params.type);
    const tmdbId = Number(req.params.tmdbId);
    if ((type !== 'movie' && type !== 'tv') || !Number.isInteger(tmdbId) || tmdbId <= 0) throw new HttpError(400, 'Invalid title');
    return mediaDetails(ctxOf(req.session!), type, tmdbId, { isAdmin: !!req.session!.isAdmin, can: (a) => canSee(req, a as never) });
  }),
);
api.post(
  '/media/search',
  requireAdmin,
  handle(null, async (req) => {
    const b = z
      .object({
        kind: z.enum(['radarr', 'sonarr']),
        instance: z.string().max(64),
        id: z.number().int().positive(),
        title: z.string().max(200).optional(),
        season: z.number().int().min(0).max(1000).optional(),
        episodeIds: z.array(z.number().int().positive()).max(500).optional(),
      })
      .strict()
      .safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid request');
    const r = await arrTitleSearch(b.data.kind, b.data.instance, b.data.id, { season: b.data.season, episodeIds: b.data.episodeIds });
    audit(req, `[search] ${b.data.instance}: search for ${b.data.title ?? `#${b.data.id}`}`);
    return r;
  }),
);

/* ---------------------------------- me ---------------------------------- */

api.get('/me/overview', handle('jellyfin', (req) => myOverview(ctxOf(req.session!), req.session!.serverToken, req.session!.userName)));
api.get('/me/requests', handle(null, (req) => myRequests(ctxOf(req.session!))));

/* --------------------------------- digest -------------------------------- */

api.get(
  '/digest',
  handle('jellyfin', async (req) => {
    const d = await buildDigest(ctxOf(req.session!));
    // What other people watched is Stats information.
    return canSee(req, 'stats') ? d : { ...d, watched: undefined };
  }),
);
api.get('/digest/settings', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(digestSettings()));
api.put(
  '/digest/settings',
  requireAdmin,
  handle(null, async (req) => {
    const b = z.object({ enabled: z.boolean().optional(), day: z.number().int().min(0).max(6).optional(), hour: z.number().int().min(0).max(23).optional() }).strict().safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid settings');
    audit(req, `[notify] weekly digest settings changed: ${JSON.stringify(b.data)}`);
    return updateDigest(b.data);
  }),
);
api.post(
  '/digest/send',
  requireAdmin,
  handle('jellyfin', async (req) => {
    try {
      await sendDigest();
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    audit(req, '[notify] weekly digest sent now');
    return digestSettings();
  }),
);

/* -------------------------------- search -------------------------------- */

api.get(
  '/search',
  handle(null, async (req) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (q.length < 2) return { library: [], managed: [], discover: [], canRequest: false, canAdd: false };
    return search(ctxOf(req.session!), q, (a) => canSee(req, a as never), !!req.session!.isAdmin);
  }),
);

const requestBody = z.object({ mediaType: z.enum(['movie', 'tv']), tmdbId: z.number().int().positive(), title: z.string().max(200).optional() }).strict();
api.post(
  '/search/request',
  handle('seerr', async (req) => {
    if (!req.session!.isAdmin && !canSee(req, 'requests')) throw new HttpError(403, 'Your account can’t make requests here.', 'forbidden');
    const b = requestBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid request');
    const r = await requestMedia(req.session!.userId, !!req.session!.isAdmin, b.data.mediaType, b.data.tmdbId);
    audit(req, `[seerr] requested ${b.data.title ?? `${b.data.mediaType} ${b.data.tmdbId}`}`);
    return r;
  }),
);

const addBody = z
  .object({ kind: z.enum(['sonarr', 'radarr']), tmdbId: z.number().int().positive().optional(), tvdbId: z.number().int().positive().optional(), instance: z.string().max(64).optional(), title: z.string().max(200).optional() })
  .strict();
api.post(
  '/search/add',
  requireAdmin,
  handle(null, async (req) => {
    const b = addBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid request');
    const r = await addToArr(b.data.kind, b.data, b.data.instance);
    audit(req, `[search] added ${r.title} to ${r.instance}`);
    return r;
  }),
);

/* --------------------------------- rules -------------------------------- */

const ruleBody = z
  .object({
    name: z.string().trim().max(80).default(''),
    enabled: z.boolean().default(true),
    condition: z.enum(CONDITION_TYPES as [string, ...string[]]),
    value: z.number(),
    actions: z.array(z.enum(ACTION_TYPES as [string, ...string[]])).max(ACTION_TYPES.length),
    cooldownHours: z.number().int().min(0).max(24 * 30).default(24),
  })
  .strict();
const ruleError = (err: unknown) => {
  if (err instanceof RuleError) throw new HttpError(400, err.message);
  throw err;
};
api.get('/rules', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(rulesStatus()));
api.post(
  '/rules',
  requireAdmin,
  handle(null, async (req) => {
    const b = ruleBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid rule');
    try {
      const r = saveRule(b.data as Parameters<typeof saveRule>[0]);
      audit(req, `[rules] rule “${r.name}” added`);
      return rulesStatus();
    } catch (err) {
      return ruleError(err);
    }
  }),
);
api.put(
  '/rules/:id',
  requireAdmin,
  handle(null, async (req) => {
    const b = ruleBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, b.error.issues[0]?.message ?? 'Invalid rule');
    try {
      const r = saveRule({ ...(b.data as Parameters<typeof saveRule>[0]), id: String(req.params.id) });
      audit(req, `[rules] rule “${r.name}” updated`);
      return rulesStatus();
    } catch (err) {
      return ruleError(err);
    }
  }),
);
api.delete(
  '/rules/:id',
  requireAdmin,
  handle(null, async (req) => {
    if (!removeRule(String(req.params.id))) throw new HttpError(404, 'Unknown rule', 'not_found');
    audit(req, `[rules] rule ${String(req.params.id)} removed`);
    return rulesStatus();
  }),
);
api.post(
  '/rules/:id/run',
  requireAdmin,
  handle(null, async (req) => {
    const fire = (req.body as { fire?: unknown } | undefined)?.fire === true;
    try {
      const r = await runRule(String(req.params.id), fire);
      return { ...r, status: rulesStatus() };
    } catch (err) {
      return ruleError(err);
    }
  }),
);

/* --------------------------------- audit -------------------------------- */

/* ------------------------------- diagnosis ------------------------------- */

api.get('/diagnosis', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(diagnosisStatus()));
api.get(
  '/diagnosis/explain',
  requireAdmin,
  handle(null, async (req) => {
    const str = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
    try {
      return explain({ incident: str(req.query.incident), session: str(req.query.session), at: Number(req.query.at) || undefined });
    } catch (err) {
      if (err instanceof DiagnosisError) throw new HttpError(400, err.message);
      throw err;
    }
  }),
);
const diagnosisBody = z.object({ uploadMbps: z.number().positive().max(100_000).nullable() }).strict();
api.put(
  '/diagnosis/settings',
  requireAdmin,
  handle(null, async (req) => {
    const b = diagnosisBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Enter your upload speed in Mbps');
    updateDiagnosisPrefs(b.data);
    audit(req, b.data.uploadMbps ? `[diagnosis] upload speed set to ${b.data.uploadMbps} Mbps` : '[diagnosis] upload speed cleared');
    return diagnosisStatus();
  }),
);

/* -------------------------------- updates -------------------------------- */

api.get('/updates', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(updateStatus()));
api.post('/updates/check', requireAdmin, handle(null, () => checkNow()));

/* ------------------------------ playability ------------------------------ */

const playabilityError = (err: unknown): never => {
  if (err instanceof PlayabilityError) throw new HttpError(400, err.message);
  throw err;
};
api.get('/playability', requireAdmin, (_req, res) => res.set('Cache-Control', 'no-store').json(playabilityStatus()));
api.get(
  '/playability/device',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const key = typeof req.query.key === 'string' && req.query.key.length <= 300 ? req.query.key : '';
    return deviceReport(key).catch(playabilityError);
  }),
);
api.get(
  '/playability/title/:id',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9-]{32,36}$/i.test(id)) throw new HttpError(400, 'Invalid item id');
    return titlePlayability(id).catch(playabilityError);
  }),
);

api.get('/audit', requireAdmin, (req, res) => {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : undefined);
  res.set('Cache-Control', 'no-store').json(
    auditEntries({
      category: str(req.query.category),
      user: str(req.query.user),
      q: str(req.query.q),
      before: Number(req.query.before) || undefined,
      limit: Number(req.query.limit) || undefined,
    }),
  );
});

/* -------------------------------- settings ------------------------------ */

api.use('/settings', settingsRouter);

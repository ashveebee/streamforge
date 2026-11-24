import type { Request } from 'express';
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
import { hostSnapshot } from './host.js';
import * as jellyfin from './services/jellyfin.js';
import { anyInstance, arrInstances } from './services/instances.js';
import { playbackStats } from './services/playStats.js';
import { scanAll, scanLibrary, scheduledTasks, startTask, stopTask, TASK_ID_RE } from './services/jellyfinTasks.js';
import { libraryHealth } from './services/libraryHealth.js';
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
      SERVICE_IDS.map((id) => [id, canSee(req, id) && (id === 'sonarr' || id === 'radarr' ? anyInstance(id) : isConfigured(id))]),
    ),
    // A service the user can't see counts as switched off for them.
    enabled: Object.fromEntries(SERVICE_IDS.map((id) => [id, isEnabled(id) && canSee(req, id)])),
    instances: arrInstances()
      .filter((i) => canSee(req, i.kind))
      .map((i) => ({ id: i.id, kind: i.kind, name: i.name, primary: i.primary })),
    /** Areas this user can open; null means everything (admins). */
    access: allowedAreas(req) ? [...allowedAreas(req)!] : null,
    downloadClients: hasClients() && canSee(req, 'downloads'),
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

/* -------------------------------- jellyfin ------------------------------ */

api.get('/jellyfin/now-playing', handle('jellyfin', (req) => jellyfin.nowPlaying(ctxOf(req.session!))));
api.get('/jellyfin/overview', handle('jellyfin', (req) => jellyfin.overview(ctxOf(req.session!))));
api.get('/jellyfin/latest', handle('jellyfin', (req) => jellyfin.latest(ctxOf(req.session!))));
api.get('/jellyfin/activity', handle('jellyfin', (req) => jellyfin.activity(ctxOf(req.session!))));
api.get('/jellyfin/plays', handle('jellyfin', (req) => jellyfin.playbackHistory(ctxOf(req.session!))));
api.get(
  '/jellyfin/stats',
  handle('jellyfin', (req) => {
    const days = [7, 30, 90, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    return playbackStats(ctxOf(req.session!), days);
  }),
);

const sessionBody = z
  .object({ command: z.enum(['pause', 'unpause', 'stop', 'message']), text: z.string().trim().max(500).optional() })
  .strict();
api.post(
  '/jellyfin/sessions/:id/control',
  requireAdmin,
  handle('jellyfin', async (req) => {
    const id = String(req.params.id);
    const b = sessionBody.safeParse(req.body ?? {});
    if (!jellyfin.SESSION_ID_RE.test(id) || !b.success) throw new HttpError(400, 'Invalid request');
    if (b.data.command === 'message' && !b.data.text) throw new HttpError(400, 'Enter a message');
    // A stop can carry a message explaining why, shown before playback ends.
    if (b.data.command === 'stop' && b.data.text) await jellyfin.controlSession(ctxOf(req.session!), id, 'message', b.data.text);
    await jellyfin.controlSession(ctxOf(req.session!), id, b.data.command, b.data.text);
    audit(req, `[jellyfin] stream ${id}: ${b.data.command}${b.data.text ? ` (“${b.data.text}”)` : ''}`);
    return { ok: true };
  }),
);

/* Scheduled tasks and library scans (admins). */
api.get('/jellyfin/tasks', requireAdmin, handle('jellyfin', (req) => scheduledTasks(ctxOf(req.session!))));
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
    const b = z.object({ library: z.string().optional(), name: z.string().max(120).optional(), full: z.boolean().optional() }).strict().safeParse(req.body ?? {});
    if (!b.success || (b.data.library && !jellyfin.isValidId(b.data.library))) throw new HttpError(400, 'Invalid request');
    if (b.data.library) await scanLibrary(ctxOf(req.session!), b.data.library, !!b.data.full);
    else await scanAll(ctxOf(req.session!));
    audit(req, `[jellyfin] ${b.data.full ? 'metadata refresh' : 'library scan'}: ${b.data.library ? (b.data.name ?? b.data.library) : 'all libraries'}`);
    return { ok: true };
  }),
);

function imageOpts(req: Request) {
  const tag = typeof req.query.tag === 'string' && /^[\w-]{1,64}$/.test(req.query.tag) ? req.query.tag : undefined;
  const w = Number(req.query.w);
  return { tag, maxWidth: Number.isFinite(w) && w > 0 ? Math.min(Math.round(w), 2400) : undefined };
}

api.get('/jellyfin/image/items/:id/:type', (req, res) => {
  const id = String(req.params.id);
  const type = String(req.params.type);
  if (!jellyfin.isValidId(id) || !jellyfin.isValidImageType(type)) {
    res.status(400).end();
    return;
  }
  void pipeImage(res, jellyfin.image(ctxOf(req.session!), 'Items', id, type, imageOpts(req)));
});

api.get('/jellyfin/image/users/:id', (req, res) => {
  const id = String(req.params.id);
  if (!jellyfin.isValidId(id)) {
    res.status(400).end();
    return;
  }
  void pipeImage(res, jellyfin.image(ctxOf(req.session!), 'Users', id, 'Primary', imageOpts(req)));
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

/* --------------------------------- audit -------------------------------- */

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

import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { ctxOf, requireAuth } from './auth.js';
import { UpstreamError, type ServiceClient } from './lib/http.js';
import { downloadSnapshot, healthSnapshot, recheck } from './health.js';
import { isConfigured, isEnabled, SERVICE_IDS } from './settings.js';
import { requireAdmin, settingsRouter } from './settingsRoutes.js';
import { z } from 'zod';
import { autoImportStatus, INTERVALS, runAutoImport, updateAutoImport } from './services/autoImport.js';
import { hostSnapshot } from './host.js';
import * as jellyfin from './services/jellyfin.js';
import { COVER_FILE_RE, radarr, radarrOverview, sonarr, sonarrOverview } from './services/arr.js';
import { prowlarrOverview } from './services/prowlarr.js';
import { seerrOverview } from './services/seerr.js';
import { infinidiskOverview } from './services/infinidisk.js';
import type { ServiceId } from './services/types.js';

export const api = Router();
api.use(requireAuth);

/** Wraps a handler so upstream failures become clean JSON errors. */
function handle(service: ServiceId | null, fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    if (service && !isConfigured(service)) {
      res.status(404).json({ error: 'not_configured', service, message: `${service} is not configured` });
      return;
    }
    try {
      res.set('Cache-Control', 'no-store').json(await fn(req));
    } catch (err) {
      const e = err as UpstreamError;
      const status = e instanceof UpstreamError ? 502 : 500;
      if (status === 500) console.error(`[${service ?? 'api'}]`, err);
      res.status(status).json({ error: 'upstream', service, message: e.message });
    }
  };
}

/** Streams an upstream image to the client with sensible cache headers. */
async function pipeImage(res: Response, upstream: Promise<globalThis.Response>) {
  try {
    const r = await upstream;
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !r.body || !type.startsWith('image/')) {
      res.status(r.status === 200 ? 404 : r.status).end();
      return;
    }
    res.set({
      'Content-Type': type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    const len = r.headers.get('content-length');
    if (len) res.set('Content-Length', len);
    Readable.fromWeb(r.body as never).pipe(res);
  } catch {
    res.status(502).end();
  }
}

/* --------------------------------- core --------------------------------- */

api.get('/config', (_req, res) => {
  res.json({
    services: Object.fromEntries(SERVICE_IDS.map((id) => [id, isConfigured(id)])),
    enabled: Object.fromEntries(SERVICE_IDS.map((id) => [id, isEnabled(id)])),
  });
});
api.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').json(healthSnapshot()));
api.post('/health/recheck', handle(null, () => recheck()));
api.get('/system/host', (_req, res) => res.set('Cache-Control', 'no-store').json(hostSnapshot()));
api.get('/downloads', (_req, res) => res.set('Cache-Control', 'no-store').json(downloadSnapshot()));

/* -------------------------------- jellyfin ------------------------------ */

api.get('/jellyfin/now-playing', handle('jellyfin', (req) => jellyfin.nowPlaying(ctxOf(req.session!))));
api.get('/jellyfin/overview', handle('jellyfin', (req) => jellyfin.overview(ctxOf(req.session!))));
api.get('/jellyfin/latest', handle('jellyfin', (req) => jellyfin.latest(ctxOf(req.session!))));
api.get('/jellyfin/activity', handle('jellyfin', (req) => jellyfin.activity(ctxOf(req.session!))));
api.get('/jellyfin/plays', handle('jellyfin', (req) => jellyfin.playbackHistory(ctxOf(req.session!))));

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

function coverRoute(getClient: () => ServiceClient | undefined) {
  return (req: Request, res: Response) => {
    const client = getClient();
    const id = String(req.params.id);
    const file = String(req.params.file);
    if (!client || !/^\d{1,9}$/.test(id) || !COVER_FILE_RE.test(file)) {
      res.status(400).end();
      return;
    }
    // Ask for the small variant (e.g. poster-250.jpg) unless one was requested.
    const sized = /-\d+\./.test(file) ? file : file.replace(/\.(\w+)$/, '-500.$1');
    void pipeImage(res, client.raw(`/MediaCover/${id}/${sized}`, undefined, { Accept: 'image/*' }));
  };
}

api.get('/sonarr/overview', handle('sonarr', () => sonarrOverview()));
api.get('/sonarr/cover/:id/:file', coverRoute(sonarr));

/* Intelligent import for downloads Sonarr couldn't match on its own. */
const autoImportPatch = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().int().refine((n) => (INTERVALS as readonly number[]).includes(n), 'Unsupported interval').optional(),
  })
  .strict();
const autoImportRun = z.object({ dryRun: z.boolean().optional(), queueId: z.number().int().positive().optional() }).strict();

api.get('/sonarr/auto-import', handle('sonarr', async () => autoImportStatus()));
api.put('/sonarr/auto-import', requireAdmin, (req, res) => {
  const parsed = autoImportPatch.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid settings' });
    return;
  }
  console.log(`[auto-import] settings changed by ${req.session!.userName}: ${JSON.stringify(parsed.data)}`);
  res.json(updateAutoImport(parsed.data));
});
api.post(
  '/sonarr/auto-import/run',
  requireAdmin,
  handle('sonarr', async (req) => {
    const opts = autoImportRun.safeParse(req.body ?? {}).data ?? {};
    const results = await runAutoImport({ trigger: 'manual', ...opts });
    return { results, status: autoImportStatus() };
  }),
);
api.get('/radarr/overview', handle('radarr', () => radarrOverview()));
api.get('/radarr/cover/:id/:file', coverRoute(radarr));
api.get('/prowlarr/overview', handle('prowlarr', () => prowlarrOverview()));
api.get('/seerr/overview', handle('seerr', () => seerrOverview()));
api.get('/infinidisk/overview', handle('infinidisk', () => infinidiskOverview()));

/* -------------------------------- settings ------------------------------ */

api.use('/settings', settingsRouter);

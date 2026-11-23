import type { Request } from 'express';
import { Router } from 'express';
import { handle, pipeImage } from './lib/handle.js';
import { arrRouter } from './arrRoutes.js';
import { ctxOf, requireAuth } from './auth.js';
import { downloadSnapshot, healthSnapshot, recheck } from './health.js';
import { isConfigured, isEnabled, SERVICE_IDS } from './settings.js';
import { settingsRouter } from './settingsRoutes.js';
import { hostSnapshot } from './host.js';
import * as jellyfin from './services/jellyfin.js';
import { anyInstance, arrInstances } from './services/instances.js';
import { prowlarrOverview } from './services/prowlarr.js';
import { seerrOverview } from './services/seerr.js';
import { infinidiskOverview } from './services/infinidisk.js';

export const api = Router();
api.use(requireAuth);

/* --------------------------------- core --------------------------------- */

api.get('/config', (_req, res) => {
  res.json({
    // Sonarr/Radarr count as configured when any instance is set up.
    services: Object.fromEntries(
      SERVICE_IDS.map((id) => [id, id === 'sonarr' || id === 'radarr' ? anyInstance(id) : isConfigured(id)]),
    ),
    enabled: Object.fromEntries(SERVICE_IDS.map((id) => [id, isEnabled(id)])),
    instances: arrInstances().map((i) => ({ id: i.id, kind: i.kind, name: i.name, primary: i.primary })),
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

api.use(arrRouter);
api.get('/prowlarr/overview', handle('prowlarr', () => prowlarrOverview()));
api.get('/seerr/overview', handle('seerr', () => seerrOverview()));
api.get('/infinidisk/overview', handle('infinidisk', () => infinidiskOverview()));

/* -------------------------------- settings ------------------------------ */

api.use('/settings', settingsRouter);

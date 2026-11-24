import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import { audit } from './lib/audit.js';
import { handle, HttpError } from './lib/handle.js';
import { adapterFor, clientsSnapshot, getClient, refreshClient } from './services/clients/index.js';

/* Download client views and controls (under /api/clients). */

export const clientRouter = Router();

function clientOf(id: string) {
  const c = getClient(id);
  if (!c || !c.enabled) throw new HttpError(404, 'Unknown download client', 'not_found');
  return c;
}

clientRouter.get('/clients', (_req, res) => res.set('Cache-Control', 'no-store').json(clientsSnapshot()));

clientRouter.post(
  '/clients/:id/paused',
  requireAdmin,
  handle(null, async (req) => {
    const c = clientOf(String(req.params.id));
    const paused = (req.body as { paused?: unknown } | undefined)?.paused === true;
    await adapterFor(c).setPaused(paused);
    audit(req, `[downloads] ${c.name}: ${paused ? 'paused' : 'resumed'} everything`);
    await refreshClient(c.id);
    return clientsSnapshot();
  }),
);

const ITEM_ACTIONS = ['pause', 'resume', 'remove', 'remove-data'] as const;
clientRouter.post(
  '/clients/:id/items/:item/:action',
  requireAdmin,
  handle(null, async (req) => {
    const c = clientOf(String(req.params.id));
    const item = String(req.params.item);
    const action = String(req.params.action) as (typeof ITEM_ACTIONS)[number];
    if (!/^[\w.-]{1,128}$/.test(item) || !ITEM_ACTIONS.includes(action)) throw new HttpError(400, 'Invalid request');
    const name = req.body && typeof (req.body as { name?: unknown }).name === 'string' ? String((req.body as { name: string }).name).slice(0, 200) : item;
    await adapterFor(c).item(item, action);
    audit(req, `[downloads] ${c.name}: ${action === 'remove-data' ? 'removed with data' : action === 'remove' ? 'removed' : `${action}d`} “${name}”`);
    await refreshClient(c.id);
    return clientsSnapshot();
  }),
);

const limitsBody = z.object({ down: z.number().min(0).max(1e11), up: z.number().min(0).max(1e11).default(0) }).strict();
clientRouter.put(
  '/clients/:id/limits',
  requireAdmin,
  handle(null, async (req) => {
    const c = clientOf(String(req.params.id));
    const b = limitsBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, 'Invalid limits');
    await adapterFor(c).setLimits(b.data.down, b.data.up);
    const fmt = (n: number) => (n ? `${Math.round(n / 1024)} KiB/s` : 'unlimited');
    audit(req, `[downloads] ${c.name}: speed limits set to ↓ ${fmt(b.data.down)} ↑ ${fmt(b.data.up)}`);
    await refreshClient(c.id);
    return clientsSnapshot();
  }),
);

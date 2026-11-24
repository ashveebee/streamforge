import type { Request, Response } from 'express';
import { requireAdmin } from './auth.js';
import { AREAS, memberAccess, setMemberAccess } from './access.js';
import { Router } from 'express';
import { audit } from './lib/audit.js';
import { z } from 'zod';
import { createClient, UpstreamError } from './lib/http.js';
import { sessions } from './lib/sessions.js';
import * as jellyfin from './services/jellyfin.js';
import { arrProbe } from './services/arr.js';
import { seerrClient, seerrProbe } from './services/seerr.js';
import { infinidiskProbe, infinidiskTarget } from './services/infinidisk.js';
import { bazarrClient, bazarrProbe } from './services/bazarr.js';
import {
  addPushSubscription,
  CHANNEL_TYPES,
  ChannelError,
  describeChannel,
  EVENT_TYPES,
  hasPushSubscription,
  notificationsStatus,
  removeChannel,
  removePushSubscription,
  saveChannel,
  setPublicUrl,
  testChannel,
} from './services/notify.js';
import { addInstance, describeInstances, getStoredInstance, removeInstance, updateInstance } from './services/instances.js';
import type { HealthProbe, ServiceId } from './services/types.js';
import {
  describe,
  infinidiskSettings,
  isComplete,
  resetSettings,
  resolve,
  saveSettings,
  SERVICE_IDS,
  SERVICE_NAMES,
  canDisable,
  setEnabled,
  type ServiceSettings,
} from './settings.js';

/* ------------------------------ validation ----------------------------- */

function isHttpUrl(v: string) {
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch {
    return false;
  }
}

export const urlField = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === '' || isHttpUrl(v), 'Enter a full http:// or https:// address')
  .transform((v) => v.replace(/\/+$/, ''));

const pathField = z
  .string()
  .trim()
  .max(512)
  .refine((v) => v === '' || /^\/\S*$/.test(v), 'Must start with / and contain no spaces');

const body = z
  .object({
    url: urlField.optional(),
    /** Omitted = keep the saved key; empty string = remove it. */
    apiKey: z.string().trim().max(1024).optional(),
    authHeader: z
      .string()
      .trim()
      .max(128)
      .regex(/^[A-Za-z0-9-]*$/, 'Header names may only contain letters, digits and dashes')
      .optional(),
    statusPath: pathField.optional(),
    healthPath: pathField.optional(),
    mounts: z.array(z.string().trim().max(1024)).max(32).optional(),
  })
  .strict();
type Body = z.infer<typeof body>;

const origin = (url?: string) => (url ? new URL(url).origin : undefined);

/** Applies the submitted fields on top of the current settings. */
function merge(id: ServiceId, b: Body): ServiceSettings {
  const current = resolve(id).settings;
  const next: ServiceSettings = { url: current.url, apiKey: current.apiKey };
  if (b.url !== undefined) next.url = b.url;
  if (b.apiKey !== undefined) next.apiKey = b.apiKey;
  if (id === 'infinidisk') {
    next.authHeader = b.authHeader ?? current.authHeader;
    next.statusPath = b.statusPath ?? current.statusPath;
    next.healthPath = b.healthPath ?? current.healthPath;
    next.mounts = b.mounts ?? current.mounts;
  }
  // Never send a saved key to a different server unless it was re-entered.
  if (b.apiKey === undefined && current.apiKey && origin(next.url) !== origin(current.url)) {
    throw new SettingsError('Re-enter the API key when changing the server address.');
  }
  return next;
}

class SettingsError extends Error {}

function missing(id: ServiceId, s: ServiceSettings) {
  if (isComplete(id, s)) return undefined;
  if (id === 'jellyfin') return 'Enter the Jellyfin server address.';
  if (id === 'infinidisk') return 'Enter a server address or at least one local mount path.';
  return s.url ? 'Enter the API key.' : 'Enter the server address and API key.';
}

/* -------------------------------- testing ------------------------------ */

/** Runs the service's health probe against candidate settings without saving. */
export async function testSettings(id: ServiceId, s: ServiceSettings): Promise<HealthProbe> {
  const { url = '', apiKey = '' } = s;
  switch (id) {
    case 'jellyfin':
      return jellyfin.probe({ url, apiKey: apiKey || undefined });
    case 'sonarr':
    case 'radarr':
    case 'prowlarr':
    case 'lidarr':
    case 'readarr':
      return arrProbe(createClient(id, url, { 'X-Api-Key': apiKey }), id === 'sonarr' || id === 'radarr' ? 'v3' : 'v1');
    case 'bazarr':
      return bazarrProbe(bazarrClient(url, apiKey));
    case 'seerr':
      return seerrProbe(seerrClient(url, apiKey));
    case 'infinidisk':
      return infinidiskProbe(infinidiskTarget(infinidiskSettings(s)));
  }
}

async function runTest(id: ServiceId, s: ServiceSettings) {
  const started = performance.now();
  try {
    const r = await testSettings(id, s);
    return {
      ok: true as const,
      version: r.version,
      latencyMs: Math.round(performance.now() - started),
      issues: r.issues,
    };
  } catch (err) {
    const message = err instanceof UpstreamError ? err.message : 'Unexpected error while testing';
    if (!(err instanceof UpstreamError)) console.error(`[settings] test ${id}`, err);
    return { ok: false as const, message };
  }
}

/* -------------------------------- routes ------------------------------- */

function serviceParam(req: Request, res: Response): ServiceId | undefined {
  const id = String(req.params.id) as ServiceId;
  if (!SERVICE_IDS.includes(id)) {
    res.status(404).json({ error: 'not_found', message: 'Unknown service' });
    return undefined;
  }
  return id;
}

function parseBody(id: ServiceId, req: Request, res: Response): ServiceSettings | undefined {
  const parsed = body.safeParse(req.body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: 'bad_request', field: issue?.path.join('.'), message: issue?.message ?? 'Invalid settings' });
    return undefined;
  }
  try {
    return merge(id, parsed.data);
  } catch (err) {
    if (err instanceof SettingsError) {
      res.status(400).json({ error: 'bad_request', field: 'apiKey', message: err.message });
      return undefined;
    }
    throw err;
  }
}

export const settingsRouter = Router();
settingsRouter.use(requireAdmin);

settingsRouter.get('/services', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ services: SERVICE_IDS.map(describe) });
});

settingsRouter.post('/services/:id/test', async (req, res) => {
  const id = serviceParam(req, res);
  if (!id) return;
  const s = parseBody(id, req, res);
  if (!s) return;
  const gap = missing(id, s);
  if (gap) {
    res.json({ ok: false, message: gap });
    return;
  }
  res.json(await runTest(id, s));
});

settingsRouter.put('/services/:id', (req, res) => {
  const id = serviceParam(req, res);
  if (!id) return;
  const s = parseBody(id, req, res);
  if (!s) return;
  if (id === 'jellyfin' && !s.url) {
    res.status(400).json({ error: 'bad_request', field: 'url', message: 'Jellyfin is required for signing in.' });
    return;
  }
  const previous = resolve(id).settings;
  saveSettings(id, s, req.session!.userName);
  // Sessions belong to the old Jellyfin server; they mean nothing on a new one.
  const signedOut = id === 'jellyfin' && origin(previous.url) !== origin(s.url);
  if (signedOut) sessions.clear();
  audit(req, `[settings] ${SERVICE_NAMES[id]} updated`);
  res.json({ service: describe(id), signedOut });
});

settingsRouter.delete('/services/:id', (req, res) => {
  const id = serviceParam(req, res);
  if (!id) return;
  if (id === 'jellyfin' && !describe('jellyfin').envAvailable) {
    res.status(400).json({
      error: 'bad_request',
      message: 'There is no Jellyfin address in the environment to fall back to.',
    });
    return;
  }
  const previous = resolve(id).settings;
  resetSettings(id);
  const signedOut = id === 'jellyfin' && origin(previous.url) !== origin(resolve(id).settings.url);
  if (signedOut) sessions.clear();
  audit(req, `[settings] ${SERVICE_NAMES[id]} reset to environment`);
  res.json({ service: describe(id), signedOut });
});

settingsRouter.put('/services/:id/enabled', (req, res) => {
  const id = serviceParam(req, res);
  if (!id) return;
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', message: 'Expected { enabled: boolean }' });
    return;
  }
  if (!canDisable(id)) {
    res.status(400).json({ error: 'bad_request', message: `${SERVICE_NAMES[id]} is required and can't be disabled.` });
    return;
  }
  setEnabled(id, parsed.data.enabled);
  audit(req, `[settings] ${SERVICE_NAMES[id]} ${parsed.data.enabled ? 'enabled' : 'disabled'}`);
  res.json({ service: describe(id), signedOut: false });
});

/* ------------------------- extra Sonarr/Radarr ------------------------- */

const instanceBody = z
  .object({
    kind: z.enum(['sonarr', 'radarr']).optional(),
    name: z.string().trim().min(1, 'Give the instance a name').max(40).optional(),
    url: urlField.optional(),
    apiKey: z.string().trim().max(1024).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

function badRequest(res: Response, message: string, field?: string) {
  res.status(400).json({ error: 'bad_request', field, message });
}

settingsRouter.get('/instances', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ instances: describeInstances() });
});

/** Tests candidate details; reuses the saved key when `id` is given and no key is. */
settingsRouter.post('/instances/test', async (req, res) => {
  const parsed = instanceBody.extend({ id: z.string().max(64).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', parsed.error.issues[0]?.path.join('.'));
  const b = parsed.data;
  const saved = b.id ? getStoredInstance(b.id) : undefined;
  const apiKey = b.apiKey || saved?.apiKey;
  const url = b.url ?? saved?.url;
  if (!url || !apiKey) return res.json({ ok: false, message: 'Enter the server address and API key.' });
  if (saved && !b.apiKey && origin(url) !== origin(saved.url)) {
    return res.json({ ok: false, message: 'Re-enter the API key when changing the server address.' });
  }
  res.json(await runTest(b.kind ?? saved?.kind ?? 'sonarr', { url, apiKey }));
});

settingsRouter.post('/instances', (req, res) => {
  const parsed = instanceBody.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', parsed.error.issues[0]?.path.join('.'));
  const { kind, name, url, apiKey } = parsed.data;
  if (!kind) return badRequest(res, 'Missing kind');
  if (!name) return badRequest(res, 'Give the instance a name', 'name');
  if (!url) return badRequest(res, 'Enter the server address', 'url');
  if (!apiKey) return badRequest(res, 'Enter the API key', 'apiKey');
  const inst = addInstance({ kind, name, url, apiKey });
  audit(req, `[settings] ${SERVICE_NAMES[kind]} instance "${name}" added`);
  res.json({ instance: describeInstances().find((i) => i.id === inst.id) });
});

settingsRouter.put('/instances/:id', (req, res) => {
  const id = String(req.params.id);
  const cur = getStoredInstance(id);
  if (!cur) return res.status(404).json({ error: 'not_found', message: 'Unknown instance' });
  const parsed = instanceBody.omit({ kind: true }).safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', parsed.error.issues[0]?.path.join('.'));
  const b = parsed.data;
  // Never send a saved key to a different server unless it was re-entered.
  if (b.url && !b.apiKey && origin(b.url) !== origin(cur.url)) {
    return badRequest(res, 'Re-enter the API key when changing the server address.', 'apiKey');
  }
  updateInstance(id, { name: b.name, url: b.url, apiKey: b.apiKey || undefined, enabled: b.enabled });
  audit(req, `[settings] instance ${id} updated`);
  res.json({ instance: describeInstances().find((i) => i.id === id) });
});

settingsRouter.delete('/instances/:id', (req, res) => {
  const id = String(req.params.id);
  if (!removeInstance(id)) return res.status(404).json({ error: 'not_found', message: 'Unknown instance' });
  audit(req, `[settings] instance ${id} removed`);
  res.json({ ok: true });
});

/* ----------------------------- notifications ---------------------------- */

const channelBody = z
  .object({
    type: z.enum(CHANNEL_TYPES),
    name: z.string().trim().max(60).default(''),
    enabled: z.boolean().default(true),
    events: z.array(z.enum(EVENT_TYPES)).max(EVENT_TYPES.length),
    config: z.record(z.string().max(64), z.string().max(2048)).default({}),
  })
  .strict();

function channelError(res: Response, err: unknown) {
  if (err instanceof ChannelError) return badRequest(res, err.message, err.field ? `config.${err.field}` : undefined);
  throw err;
}

settingsRouter.get('/notifications', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(notificationsStatus());
});

settingsRouter.put('/notifications/public-url', (req, res) => {
  const parsed = z.object({ url: urlField }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', 'publicUrl');
  setPublicUrl(parsed.data.url);
  audit(req, `[settings] public address set to ${parsed.data.url || '(none)'}`);
  res.json(notificationsStatus());
});

settingsRouter.post('/notifications/channels', (req, res) => {
  const parsed = channelBody.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', parsed.error.issues[0]?.path.join('.'));
  try {
    const ch = saveChannel(parsed.data);
    audit(req, `[notify] channel "${ch.name}" (${ch.type}) added`);
    res.json({ channel: describeChannel(ch) });
  } catch (err) {
    channelError(res, err);
  }
});

settingsRouter.put('/notifications/channels/:id', (req, res) => {
  const parsed = channelBody.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid', parsed.error.issues[0]?.path.join('.'));
  try {
    const ch = saveChannel({ ...parsed.data, id: String(req.params.id) });
    audit(req, `[notify] channel "${ch.name}" (${ch.type}) updated`);
    res.json({ channel: describeChannel(ch) });
  } catch (err) {
    channelError(res, err);
  }
});

settingsRouter.delete('/notifications/channels/:id', (req, res) => {
  if (!removeChannel(String(req.params.id))) return res.status(404).json({ error: 'not_found', message: 'Unknown channel' });
  audit(req, `[notify] channel ${String(req.params.id)} removed`);
  res.json({ ok: true });
});

settingsRouter.post('/notifications/channels/:id/test', async (req, res) => {
  try {
    await testChannel(String(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ChannelError) return badRequest(res, err.message);
    res.json({ ok: false, message: (err as Error).message });
  }
});

const pushBody = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: z.string().max(256), auth: z.string().max(256) }),
    device: z.string().max(120).optional(),
  })
  .strip();

settingsRouter.post('/notifications/push/subscribe', (req, res) => {
  const parsed = pushBody.safeParse(req.body ?? {});
  if (!parsed.success || !/^https:\/\//.test(parsed.data.endpoint)) return badRequest(res, 'Invalid push subscription');
  addPushSubscription(parsed.data, req.session!.userName, parsed.data.device);
  res.json(notificationsStatus());
});

settingsRouter.post('/notifications/push/unsubscribe', (req, res) => {
  const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
  if (typeof endpoint === 'string') removePushSubscription(endpoint);
  res.json(notificationsStatus());
});

settingsRouter.post('/notifications/push/status', (req, res) => {
  const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
  res.json({ subscribed: typeof endpoint === 'string' && hasPushSubscription(endpoint) });
});

/* ------------------------------ member access ----------------------------- */

settingsRouter.get('/members', (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ ...memberAccess(), areas: memberAccess().areas, available: AREAS });
});

settingsRouter.put('/members', (req, res) => {
  const parsed = z.object({ signIn: z.boolean().optional(), areas: z.array(z.enum(AREAS)).max(AREAS.length).optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? 'Invalid');
  const next = setMemberAccess(parsed.data);
  audit(req, `[settings] member access changed: ${JSON.stringify(next)}`);
  res.json({ ...next, available: AREAS });
});

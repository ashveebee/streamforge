import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from './auth.js';
import { handle, HttpError, pipeImage } from './lib/handle.js';
import { COVER_FILE_RE, radarrOverview, sonarrOverview } from './services/arr.js';
import { autoImport, INTERVALS } from './services/autoImport.js';
import { arrInstance, ARR_KINDS, type ArrInstance, type ArrKind } from './services/instances.js';

/*
 * Sonarr and Radarr routes. Every route takes an optional `instance` (query
 * string or JSON body) to address an extra instance; without it the default
 * instance of that kind is used.
 */

export const arrRouter = Router();

function instanceOf(kind: ArrKind, req: Request): ArrInstance {
  const raw = (req.body as { instance?: unknown } | undefined)?.instance ?? req.query.instance;
  const id = typeof raw === 'string' && raw ? raw : undefined;
  const inst = arrInstance(kind, id);
  if (!inst) throw new HttpError(404, id ? `Unknown ${kind} instance` : `${kind} is not configured`, 'not_configured');
  return inst;
}

/** `handle`, but resolving the instance first. */
export function withInstance(kind: ArrKind, fn: (inst: ArrInstance, req: Request) => Promise<unknown>) {
  return handle(null, (req) => fn(instanceOf(kind, req), req));
}

function parseBody<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
  const r = schema.safeParse(req.body ?? {});
  if (!r.success) throw new HttpError(400, r.error.issues[0]?.message ?? 'Invalid request');
  return r.data;
}

const autoImportPatch = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z
      .number()
      .int()
      .refine((n) => (INTERVALS as readonly number[]).includes(n), 'Unsupported interval')
      .optional(),
  })
  .strict();
const autoImportRun = z
  .object({
    dryRun: z.boolean().optional(),
    queueId: z.number().int().positive().optional(),
    instance: z.string().max(64).optional(),
  })
  .strict();

for (const kind of ARR_KINDS) {
  arrRouter.get(`/${kind}/overview`, withInstance(kind, (inst) => (kind === 'sonarr' ? sonarrOverview(inst) : radarrOverview(inst))));

  arrRouter.get(`/${kind}/cover/:id/:file`, (req: Request, res: Response) => {
    const id = String(req.params.id);
    const file = String(req.params.file);
    let inst: ArrInstance;
    try {
      inst = instanceOf(kind, req);
    } catch {
      res.status(404).end();
      return;
    }
    if (!/^\d{1,9}$/.test(id) || !COVER_FILE_RE.test(file)) {
      res.status(400).end();
      return;
    }
    // Ask for the small variant (e.g. poster-500.jpg) unless one was requested.
    const sized = /-\d+\./.test(file) ? file : file.replace(/\.(\w+)$/, '-500.$1');
    void pipeImage(res, inst.client.raw(`/MediaCover/${id}/${sized}`, undefined, { Accept: 'image/*' }));
  });

  /* Intelligent import for downloads that couldn't be matched automatically. */
  arrRouter.get(`/${kind}/auto-import`, withInstance(kind, async () => autoImport(kind).status()));
  arrRouter.put(
    `/${kind}/auto-import`,
    requireAdmin,
    handle(null, async (req) => {
      const patch = parseBody(autoImportPatch, req);
      console.log(`[auto-import:${kind}] settings changed by ${req.session!.userName}: ${JSON.stringify(patch)}`);
      return autoImport(kind).update(patch);
    }),
  );
  arrRouter.post(
    `/${kind}/auto-import/run`,
    requireAdmin,
    handle(null, async (req) => {
      const opts = parseBody(autoImportRun, req);
      if (opts.instance) instanceOf(kind, req);
      const results = await autoImport(kind).run({ trigger: 'manual', ...opts });
      return { results, status: autoImport(kind).status() };
    }),
  );
}

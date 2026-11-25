import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { UpstreamError } from './http.js';
import { isConfigured } from '../settings.js';
import { plexMode } from '../services/mainServer.js';
import type { ServiceId } from '../services/types.js';

/** Thrown by handlers for a clean 4xx response. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'bad_request',
  ) {
    super(message);
  }
}

/** Wraps a handler so upstream failures become clean JSON errors. */
export function handle(service: ServiceId | null, fn: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    // With Plex as the sign-in server, media routes serve the main Plex server instead of Jellyfin.
    if (service && !isConfigured(service) && !(service === 'jellyfin' && plexMode())) {
      res.status(404).json({ error: 'not_configured', service, message: `${service} is not configured` });
      return;
    }
    try {
      res.set('Cache-Control', 'no-store').json(await fn(req));
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.code, service, message: err.message });
        return;
      }
      const e = err as UpstreamError;
      const status = e instanceof UpstreamError ? 502 : 500;
      if (status === 500) console.error(`[${service ?? 'api'}]`, err);
      res.status(status).json({ error: 'upstream', service, message: e.message });
    }
  };
}

/** Streams an upstream image to the client with sensible cache headers. */
export async function pipeImage(res: Response, upstream: Promise<globalThis.Response>) {
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


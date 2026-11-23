import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { newDeviceId, sessions, SESSION_COOKIE, type Session } from './lib/sessions.js';
import { UpstreamError } from './lib/http.js';
import * as jellyfin from './services/jellyfin.js';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

const REVALIDATE_MS = 5 * 60_000;

function readCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

function cookieOptions(req: Request) {
  const secure = config.cookieSecure === 'auto' ? req.secure : config.cookieSecure === 'true';
  return { httpOnly: true, sameSite: 'strict' as const, secure, path: '/' };
}

export function publicUser(s: Session) {
  return {
    id: s.userId,
    name: s.userName,
    isAdmin: s.isAdmin,
    imageTag: s.primaryImageTag,
    expiresAt: new Date(s.expiresAt).toISOString(),
  };
}

export const ctxOf = (s: Session): jellyfin.JfCtx => ({
  token: s.token,
  deviceId: s.deviceId,
  userId: s.userId,
});

/**
 * Requires a valid session. Periodically re-validates the Jellyfin token so
 * that revoking a device or disabling a user in Jellyfin takes effect here too.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = sessions.get(readCookie(req, SESSION_COOKIE));
  if (!session) {
    res.status(401).json({ error: 'unauthenticated', message: 'Please sign in' });
    return;
  }
  if (Date.now() - session.lastValidatedAt > REVALIDATE_MS) {
    try {
      const user = await jellyfin.currentUser(session.token, session.deviceId);
      session.lastValidatedAt = Date.now();
      session.isAdmin = !!user.Policy?.IsAdministrator;
      session.primaryImageTag = user.PrimaryImageTag;
      if (user.Policy?.IsDisabled || (!session.isAdmin && !config.allowNonAdmin)) {
        throw new UpstreamError('Access revoked', 401);
      }
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
        sessions.destroy(session.id);
        res.clearCookie(SESSION_COOKIE, cookieOptions(req));
        res.status(401).json({ error: 'unauthenticated', message: 'Your Jellyfin session has ended' });
        return;
      }
      // Jellyfin temporarily unreachable: keep the session, try again later.
    }
  }
  req.session = session;
  next();
}

/**
 * Cheap CSRF defence: state-changing requests must carry a custom header.
 * Browsers cannot send custom headers cross-origin without a CORS preflight,
 * which this server never approves. Combined with SameSite=Strict cookies.
 */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-streamforge') !== '1') {
    res.status(403).json({ error: 'forbidden', message: 'Missing request header' });
    return;
  }
  next();
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'rate_limited', message: 'Too many sign-in attempts. Try again in a few minutes.' },
});

const loginBody = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().max(1024).default(''),
});

export const authRouter = Router();

authRouter.get('/server', async (_req, res) => {
  try {
    const info = await jellyfin.publicInfo();
    res.json({ name: info.ServerName, version: info.Version, online: true });
  } catch {
    res.json({ online: false });
  }
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = loginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'bad_request', message: 'Username is required' });
    return;
  }
  const deviceId = newDeviceId();
  try {
    const result = await jellyfin.authenticate(body.data.username, body.data.password, deviceId);
    const isAdmin = !!result.User.Policy?.IsAdministrator;
    if (!isAdmin && !config.allowNonAdmin) {
      await jellyfin.logout(result.AccessToken, deviceId);
      res.status(403).json({
        error: 'forbidden',
        message: 'StreamForge is restricted to Jellyfin administrators.',
      });
      return;
    }
    const prev = sessions.get(readCookie(req, SESSION_COOKIE));
    if (prev) sessions.destroy(prev.id);
    const session = sessions.create({
      userId: result.User.Id,
      userName: result.User.Name,
      isAdmin,
      primaryImageTag: result.User.PrimaryImageTag,
      token: result.AccessToken,
      deviceId,
      serverId: result.ServerId,
    });
    res.cookie(SESSION_COOKIE, session.id, { ...cookieOptions(req), maxAge: config.sessionTtlMs });
    res.json({ user: publicUser(session) });
  } catch (err) {
    const e = err as UpstreamError;
    if (e.status === 401) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    } else {
      res.status(502).json({ error: 'upstream', message: `Could not reach Jellyfin: ${e.message}` });
    }
  }
});

authRouter.post('/logout', async (req, res) => {
  const session = sessions.get(readCookie(req, SESSION_COOKIE));
  if (session) {
    sessions.destroy(session.id);
    await jellyfin.logout(session.token, session.deviceId);
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.session!) });
});

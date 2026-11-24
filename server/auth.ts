import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { membersCanSignIn } from './access.js';
import { newDeviceId, sessions, SESSION_COOKIE, type Session } from './lib/sessions.js';
import { UpstreamError } from './lib/http.js';
import { audit } from './lib/audit.js';
import { readPref } from './lib/db.js';
import { beginSetup, disable as disableMfa, finishSetup, mfaEnabled, mfaInfo, verify as verifyMfa } from './services/mfa.js';
import { authorizeUrl, finishLogin, oidcReady, oidcSettings } from './services/oidc.js';
import * as jellyfin from './services/jellyfin.js';
import { isConfigured, saveSettings } from './settings.js';
import { urlField } from './settingsRoutes.js';

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

/** Restricts a route to Jellyfin administrators. Use after requireAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.isAdmin) {
    res.status(403).json({ error: 'forbidden', message: 'Only Jellyfin administrators can do this.' });
    return;
  }
  next();
}

export const ctxOf = (s: Session): jellyfin.JfCtx => ({
  // Single sign-on sessions have no Jellyfin token of their own.
  token: s.method === 'oidc' ? (jellyfin.serverApiKey() ?? '') : s.token,
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
      const user = session.method === 'oidc' ? await jellyfin.serverUser(session.userId) : await jellyfin.currentUser(session.token, session.deviceId);
      session.lastValidatedAt = Date.now();
      session.isAdmin = !!user.Policy?.IsAdministrator;
      session.primaryImageTag = user.PrimaryImageTag;
      if (user.Policy?.IsDisabled || (!session.isAdmin && !membersCanSignIn())) {
        throw new UpstreamError('Access revoked', 401);
      }
      sessions.save(session);
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
  sessions.touch(session, req.get('user-agent'));
  req.session = session;
  next();
}

/** A stable, non-secret handle for a session (the real id is the cookie). */
export const sessionHandle = (s: Session) => createHash('sha256').update(s.id).digest('base64url').slice(0, 16);

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

/* -------------------------- sessions & challenges -------------------------- */

type SessionData = Parameters<typeof sessions.create>[0];

function startSession(req: Request, res: Response, data: SessionData) {
  const prev = sessions.get(readCookie(req, SESSION_COOKIE));
  if (prev) sessions.destroy(prev.id);
  const session = sessions.create({ ...data, userAgent: req.get('user-agent')?.slice(0, 300) });
  res.cookie(SESSION_COOKIE, session.id, { ...cookieOptions(req), maxAge: config.sessionTtlMs });
  return session;
}

/** Password sign-ins waiting for a two-factor code. */
const challenges = new Map<string, { data: SessionData; expires: number; attempts: number }>();

const ssoInfo = () => (oidcReady() ? { label: oidcSettings().label, hidePassword: oidcSettings().hidePassword } : undefined);

const loginBody = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().max(1024).default(''),
});

export const authRouter = Router();

authRouter.get('/server', async (_req, res) => {
  if (!isConfigured('jellyfin')) {
    res.json({ online: false, configured: false });
    return;
  }
  try {
    const info = await jellyfin.publicInfo();
    res.json({ name: info.ServerName, version: info.Version, online: true, configured: true, sso: ssoInfo() });
  } catch {
    res.json({ online: false, configured: true, sso: ssoInfo() });
  }
});

const setupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
});

/**
 * First-run setup: points StreamForge at a Jellyfin server. Only available
 * while no Jellyfin server is configured — afterwards, only a signed-in
 * administrator can change it (from Settings).
 */
authRouter.post('/setup', setupLimiter, async (req, res) => {
  if (isConfigured('jellyfin')) {
    res.status(409).json({ error: 'already_configured', message: 'Jellyfin is already configured.' });
    return;
  }
  const parsed = z.object({ url: urlField.refine((v) => v !== '', 'Enter your Jellyfin server address') }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid address' });
    return;
  }
  const { url } = parsed.data;
  try {
    const info = await jellyfin.probe({ url });
    if (isConfigured('jellyfin')) {
      res.status(409).json({ error: 'already_configured', message: 'Jellyfin is already configured.' });
      return;
    }
    saveSettings('jellyfin', { url }, 'setup');
    audit({ ip: req.ip }, `[settings] Jellyfin set to ${url} during first-run setup`);
    res.json({ name: info.meta?.server, version: info.version, online: true, configured: true });
  } catch (err) {
    res.status(502).json({ error: 'upstream', message: `Could not reach Jellyfin: ${(err as Error).message}` });
  }
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = loginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'bad_request', message: 'Username is required' });
    return;
  }
  if (!isConfigured('jellyfin')) {
    res.status(409).json({ error: 'not_configured', message: 'Set up your Jellyfin server first.' });
    return;
  }
  const deviceId = newDeviceId();
  try {
    const result = await jellyfin.authenticate(body.data.username, body.data.password, deviceId);
    const isAdmin = !!result.User.Policy?.IsAdministrator;
    if (!isAdmin && !membersCanSignIn()) {
      await jellyfin.logout(result.AccessToken, deviceId);
      audit({ userId: result.User.Id, userName: result.User.Name, ip: req.ip }, '[auth] sign-in refused: member access is off', false);
      res.status(403).json({
        error: 'forbidden',
        message: 'StreamForge is restricted to Jellyfin administrators.',
      });
      return;
    }
    const data = {
      userId: result.User.Id,
      userName: result.User.Name,
      isAdmin,
      primaryImageTag: result.User.PrimaryImageTag,
      token: result.AccessToken,
      deviceId,
      serverId: result.ServerId,
      method: 'password' as const,
    };
    if (mfaEnabled(data.userId)) {
      const challenge = randomBytes(24).toString('base64url');
      for (const [k, c] of challenges) if (c.expires < Date.now()) {
        challenges.delete(k);
        void jellyfin.logout(c.data.token, c.data.deviceId);
      }
      challenges.set(challenge, { data, expires: Date.now() + 5 * 60_000, attempts: 0 });
      res.json({ mfaRequired: true, challenge });
      return;
    }
    const session = startSession(req, res, data);
    audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed in');
    res.json({ user: publicUser(session) });
  } catch (err) {
    const e = err as UpstreamError;
    if (e.status === 401) {
      audit({ userName: body.data.username, ip: req.ip }, '[auth] sign-in failed: wrong username or password', false);
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
    if (session.method !== 'oidc') await jellyfin.logout(session.token, session.deviceId);
    audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed out');
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions(req));
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.session!) });
});

/* Signed-in devices: users can see and end their own sessions. */
authRouter.get('/sessions', requireAuth, (req, res) => {
  const me = req.session!;
  res.set('Cache-Control', 'no-store').json({
    sessions: sessions
      .forUser(me.userId)
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
      .map((s) => ({
        id: sessionHandle(s),
        current: s.id === me.id,
        method: s.method ?? 'password',
        userAgent: s.userAgent,
        createdAt: new Date(s.createdAt).toISOString(),
        lastSeenAt: new Date(s.lastSeenAt ?? s.createdAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
      })),
  });
});

authRouter.delete('/sessions/:id', requireAuth, async (req, res) => {
  const me = req.session!;
  const target = sessions.forUser(me.userId).find((s) => sessionHandle(s) === String(req.params.id));
  if (!target) {
    res.status(404).json({ error: 'not_found', message: 'Unknown session' });
    return;
  }
  sessions.destroy(target.id);
  if (target.method !== 'oidc') await jellyfin.logout(target.token, target.deviceId);
  res.json({ ok: true });
});

/* ------------------------------ two-factor ------------------------------ */

const mfaLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
});

authRouter.post('/mfa/verify', mfaLimiter, async (req, res) => {
  const b = z.object({ challenge: z.string().max(100), code: z.string().trim().min(6).max(20) }).strict().safeParse(req.body ?? {});
  const c = b.success ? challenges.get(b.data.challenge) : undefined;
  if (!b.success || !c || c.expires < Date.now()) {
    if (b.success) challenges.delete(b.data.challenge);
    res.status(401).json({ error: 'expired', message: 'This sign-in has expired. Enter your password again.' });
    return;
  }
  const how = verifyMfa(c.data.userId, b.data.code);
  if (!how) {
    if (++c.attempts >= 5) {
      challenges.delete(b.data.challenge);
      await jellyfin.logout(c.data.token, c.data.deviceId);
    }
    audit({ userId: c.data.userId, userName: c.data.userName, ip: req.ip }, '[auth] sign-in failed: wrong two-factor code', false);
    res.status(401).json({ error: 'invalid_code', message: 'That code didn’t work. Check your authenticator app and try again.' });
    return;
  }
  challenges.delete(b.data.challenge);
  const session = startSession(req, res, c.data);
  audit({ userId: session.userId, userName: session.userName, ip: req.ip }, `[auth] signed in with two-factor${how === 'recovery' ? ' (recovery code)' : ''}`);
  res.json({ user: publicUser(session) });
});

authRouter.get('/mfa', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store').json({ ...mfaInfo(req.session!.userId), sso: req.session!.method === 'oidc' });
});

authRouter.post('/mfa/setup', requireAuth, (req, res) => {
  if (mfaEnabled(req.session!.userId)) {
    res.status(409).json({ error: 'conflict', message: 'Two-factor sign-in is already on.' });
    return;
  }
  res.set('Cache-Control', 'no-store').json(beginSetup(req.session!.userId, req.session!.userName));
});

authRouter.post('/mfa/enable', requireAuth, mfaLimiter, (req, res) => {
  const code = String((req.body as { code?: unknown } | undefined)?.code ?? '');
  const codes = finishSetup(req.session!.userId, req.session!.userName, code);
  if (!codes) {
    res.status(400).json({ error: 'invalid_code', field: 'code', message: 'That code didn’t match. Make sure your phone’s clock is right and try the newest code.' });
    return;
  }
  audit(req, '[auth] two-factor sign-in turned on');
  res.set('Cache-Control', 'no-store').json({ recoveryCodes: codes, ...mfaInfo(req.session!.userId) });
});

authRouter.post('/mfa/disable', requireAuth, mfaLimiter, (req, res) => {
  const code = String((req.body as { code?: unknown } | undefined)?.code ?? '');
  if (!verifyMfa(req.session!.userId, code)) {
    res.status(400).json({ error: 'invalid_code', field: 'code', message: 'Enter a current code (or a recovery code) to turn this off.' });
    return;
  }
  disableMfa(req.session!.userId);
  audit(req, '[auth] two-factor sign-in turned off');
  res.json(mfaInfo(req.session!.userId));
});

/* ---------------------------- single sign-on ---------------------------- */

function publicBase(req: Request) {
  const saved = readPref<string | null>('publicUrl', null);
  return (saved || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}
const loginError = (res: Response, message: string) => res.redirect(302, `/login?error=${encodeURIComponent(message)}`);

authRouter.get('/oidc/start', setupLimiter, async (req, res) => {
  if (!oidcReady()) return loginError(res, 'Single sign-on isn’t set up.');
  try {
    res.redirect(302, await authorizeUrl(`${publicBase(req)}/api/auth/oidc/callback`));
  } catch (err) {
    loginError(res, `Couldn’t reach your identity provider: ${(err as Error).message}`);
  }
});

authRouter.get('/oidc/callback', setupLimiter, async (req, res) => {
  if (!oidcReady()) return loginError(res, 'Single sign-on isn’t set up.');
  const { code, state, error, error_description: desc } = req.query as Record<string, string | undefined>;
  if (error) return loginError(res, desc ?? error);
  if (!code || !state) return loginError(res, 'Sign-in was cancelled.');
  try {
    const who = await finishLogin(state, code);
    const users = await jellyfin.serverUsers();
    const user = users.find((u) => u.Name.toLowerCase() === who.name.toLowerCase());
    if (!user || user.Policy?.IsDisabled) {
      audit({ userName: who.name, ip: req.ip }, `[auth] single sign-on refused: no Jellyfin user named “${who.name}”`, false);
      return loginError(res, `There’s no Jellyfin user called “${who.name}”.`);
    }
    const isAdmin = !!user.Policy?.IsAdministrator;
    if (!isAdmin && !membersCanSignIn()) {
      audit({ userId: user.Id, userName: user.Name, ip: req.ip }, '[auth] single sign-on refused: member access is off', false);
      return loginError(res, 'StreamForge is restricted to Jellyfin administrators.');
    }
    const session = startSession(req, res, {
      userId: user.Id,
      userName: user.Name,
      isAdmin,
      primaryImageTag: user.PrimaryImageTag,
      token: '',
      deviceId: newDeviceId(),
      serverId: user.ServerId,
      method: 'oidc',
    });
    audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed in with single sign-on');
    res.redirect(302, '/');
  } catch (err) {
    loginError(res, (err as Error).message);
  }
});

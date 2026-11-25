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
import { mainEmby, mainPlex, mediaReady, notJellyfinMain, plexMode, setMainServer } from './services/mainServer.js';
import { addServer, describeServers, getStoredServer, updateServer } from './services/mediaServers.js';
import * as plexAuth from './services/plexAuth.js';
import * as plex from './services/plex.js';
import { discoverWithStatus, urlField } from './settingsRoutes.js';

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

/** Restricts a route to administrators (of the main Jellyfin or Plex server). Use after requireAuth. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.isAdmin) {
    res.status(403).json({ error: 'forbidden', message: 'Only administrators can do this.' });
    return;
  }
  next();
}

export const ctxOf = (s: Session): jellyfin.JfCtx => ({
  // Single sign-on sessions have no Jellyfin token of their own; Plex sessions use their server token.
  token: s.method === 'oidc' ? (jellyfin.serverApiKey() ?? '') : s.method === 'plex' ? (s.serverToken ?? '') : s.token,
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
    if (session.method === 'plex' || session.method === 'emby') {
      if (!(await (session.method === 'plex' ? revalidatePlex : revalidateEmby)(req, res, session))) return;
      sessions.touch(session, req.get('user-agent'));
      req.session = session;
      next();
      return;
    }
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

/**
 * Re-checks a Plex sign-in: the account token still works and the account
 * still has access to the main Plex server. False after answering 401.
 */
async function revalidatePlex(req: Request, res: Response, session: Session) {
  const srv = mainPlex();
  try {
    if (!srv?.serverId) throw new UpstreamError('Plex is no longer the sign-in server', 401);
    const access = await plexAuth.accessTo(session.token, srv.serverId);
    if (!access || (!access.isAdmin && !membersCanSignIn())) throw new UpstreamError('Access revoked', 401);
    session.isAdmin = access.isAdmin;
    session.serverToken = access.serverToken ?? session.serverToken;
    session.lastValidatedAt = Date.now();
    sessions.save(session);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
      sessions.destroy(session.id);
      res.clearCookie(SESSION_COOKIE, cookieOptions(req));
      res.status(401).json({ error: 'unauthenticated', message: 'Your Plex sign-in has ended' });
      return false;
    }
    // plex.tv temporarily unreachable: keep the session, try again later.
  }
  return true;
}

/** Re-checks an Emby sign-in: the token still works and the user is still allowed in. */
async function revalidateEmby(req: Request, res: Response, session: Session) {
  const srv = mainEmby();
  try {
    if (!srv) throw new UpstreamError('Emby is no longer the sign-in server', 401);
    const user = await jellyfin.embyUser(srv.url, session.token, session.userId);
    session.isAdmin = !!user.Policy?.IsAdministrator;
    session.primaryImageTag = user.PrimaryImageTag;
    if (user.Policy?.IsDisabled || (!session.isAdmin && !membersCanSignIn())) throw new UpstreamError('Access revoked', 401);
    session.lastValidatedAt = Date.now();
    sessions.save(session);
  } catch (err) {
    if (err instanceof UpstreamError && (err.status === 401 || err.status === 403)) {
      sessions.destroy(session.id);
      res.clearCookie(SESSION_COOKIE, cookieOptions(req));
      res.status(401).json({ error: 'unauthenticated', message: 'Your Emby session has ended' });
      return false;
    }
  }
  return true;
}

/** Ends a sign-in on the server it came from (Jellyfin or Emby keep a device per sign-in). */
async function remoteLogout(s: Pick<Session, 'method' | 'token' | 'deviceId'>) {
  if (s.method === 'password' || !s.method) await jellyfin.logout(s.token, s.deviceId);
  else if (s.method === 'emby') {
    const srv = mainEmby();
    if (srv) await jellyfin.embyLogout(srv.url, s.token);
  }
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

// Single sign-on matches people to Jellyfin users, so it's off while Plex is the sign-in server.
const ssoInfo = () => (oidcReady() && !notJellyfinMain() ? { label: oidcSettings().label, hidePassword: oidcSettings().hidePassword } : undefined);

const loginBody = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().max(1024).default(''),
});

export const authRouter = Router();

authRouter.get('/server', async (_req, res) => {
  const e = mainEmby();
  if (e) {
    try {
      const info = await jellyfin.embyProbe({ url: e.url });
      res.json({ type: 'emby', name: info.meta?.server ?? e.name, version: info.version, online: true, configured: true });
    } catch {
      res.json({ type: 'emby', name: e.name, online: false, configured: true });
    }
    return;
  }
  const p = mainPlex();
  if (p) {
    try {
      const info = await plex.probe({ url: p.url, apiKey: p.apiKey });
      res.json({ type: 'plex', name: info.meta?.server ?? p.name, version: info.version, online: true, configured: true });
    } catch {
      res.json({ type: 'plex', name: p.name, online: false, configured: true });
    }
    return;
  }
  if (!isConfigured('jellyfin')) {
    res.json({ online: false, configured: false });
    return;
  }
  try {
    const info = await jellyfin.publicInfo();
    res.json({ type: 'jellyfin', name: info.ServerName, version: info.Version, online: true, configured: true, sso: ssoInfo() });
  } catch {
    res.json({ type: 'jellyfin', online: false, configured: true, sso: ssoInfo() });
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
  if (mediaReady()) {
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
    if (mediaReady()) {
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

/**
 * First-run setup: looks for Jellyfin servers on the local network so the
 * address can be picked instead of typed. Only while nothing is configured.
 */
authRouter.post('/setup/discover', setupLimiter, async (req, res) => {
  if (mediaReady()) {
    res.status(409).json({ error: 'already_configured', message: 'A media server is already set up.' });
    return;
  }
  const servers = await discoverWithStatus(req.query.type === 'emby' ? ['emby'] : ['jellyfin']);
  res.json({ servers: servers.map(({ id, name, url, version, reachable }) => ({ id, name, url, version, reachable })) });
});

/* ------------------------------ Plex sign-in ------------------------------ */

const plexLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' },
});

const handleBody = z.object({ handle: z.string().min(16).max(100) }).strict();

/** Starts "Sign in with Plex": the browser opens `authUrl` and polls with `handle`. */
authRouter.post('/plex/start', setupLimiter, async (_req, res) => {
  if (mediaReady() && !plexMode()) {
    res.status(409).json({ error: 'not_plex', message: 'Sign in with your Jellyfin account.' });
    return;
  }
  try {
    res.json(await plexAuth.startPin());
  } catch (err) {
    res.status(502).json({ error: 'upstream', message: `Could not reach plex.tv: ${(err as Error).message}` });
  }
});

/** Sets up the account's servers for a first-run pick, or signs in to the main Plex server. */
authRouter.post('/plex/poll', plexLimiter, async (req, res) => {
  const b = handleBody.safeParse(req.body ?? {});
  if (!b.success) {
    res.status(400).json({ error: 'bad_request', message: 'Invalid request' });
    return;
  }
  let token: string | undefined;
  try {
    token = await plexAuth.pollPin(b.data.handle);
  } catch (err) {
    const e = err as UpstreamError;
    res.status(e.status === 410 ? 410 : 502).json({ error: e.status === 410 ? 'expired' : 'upstream', message: e.message });
    return;
  }
  if (!token) {
    res.json({ pending: true });
    return;
  }
  try {
    // First run: list the servers this account owns, to pick the main one.
    if (!mediaReady()) {
      const owned = (await plexAuth.servers(token)).filter((s) => s.owned);
      res.json({ servers: owned.map((s) => ({ id: s.clientIdentifier, name: s.name, version: s.productVersion })) });
      return;
    }
    await signInWithPlex(req, res, token);
    plexAuth.finishPin(b.data.handle);
  } catch (err) {
    res.status(502).json({ error: 'upstream', message: `Could not reach plex.tv: ${(err as Error).message}` });
  }
});

/** First run: makes one of the account's Plex servers the main server, and signs the owner in. */
authRouter.post('/plex/setup', setupLimiter, async (req, res) => {
  const b = handleBody.extend({ server: z.string().min(1).max(100) }).safeParse(req.body ?? {});
  if (!b.success) {
    res.status(400).json({ error: 'bad_request', message: 'Pick a server' });
    return;
  }
  if (mediaReady()) {
    res.status(409).json({ error: 'already_configured', message: 'A media server is already set up.' });
    return;
  }
  try {
    const token = await plexAuth.pollPin(b.data.handle);
    if (!token) {
      res.status(400).json({ error: 'bad_request', message: 'Sign in with Plex first.' });
      return;
    }
    const r = (await plexAuth.servers(token)).find((s) => s.owned && s.clientIdentifier === b.data.server);
    if (!r?.accessToken) {
      res.status(404).json({ error: 'not_found', message: 'That server isn’t one of yours on this Plex account.' });
      return;
    }
    const url = await plexAuth.reachableUri(r);
    if (!url) {
      res.status(502).json({
        error: 'unreachable',
        message: `StreamForge can’t reach “${r.name}” at any of its addresses. Make sure it’s on and reachable from where StreamForge runs.`,
      });
      return;
    }
    if (mediaReady()) {
      res.status(409).json({ error: 'already_configured', message: 'A media server is already set up.' });
      return;
    }
    const existing = describeServers().find((s) => s.type === 'plex' && s.url === url);
    const srv = existing
      ? updateServer(existing.id, { apiKey: r.accessToken, serverId: r.clientIdentifier, enabled: true })!
      : addServer({ type: 'plex', name: r.name, url, apiKey: r.accessToken, serverId: r.clientIdentifier });
    setMainServer('plex', srv.id);
    audit({ ip: req.ip }, `[settings] Plex server “${r.name}” (${url}) set as the sign-in server during first-run setup`);
    await signInWithPlex(req, res, token);
    plexAuth.finishPin(b.data.handle);
  } catch (err) {
    res.status(502).json({ error: 'upstream', message: `Could not reach plex.tv: ${(err as Error).message}` });
  }
});

/* ------------------------------ Emby sign-in ------------------------------ */

/**
 * First run, Emby: checks the server, signs the administrator in, creates an
 * API key for background features, and makes the server the sign-in server.
 */
authRouter.post('/emby/setup', setupLimiter, async (req, res) => {
  const b = z
    .object({ url: urlField.refine((v) => v !== '', 'Enter your Emby server address'), username: z.string().trim().min(1).max(256), password: z.string().max(1024).default('') })
    .strict()
    .safeParse(req.body ?? {});
  if (!b.success) {
    res.status(400).json({ error: 'bad_request', message: b.error.issues[0]?.message ?? 'Invalid request' });
    return;
  }
  if (mediaReady()) {
    res.status(409).json({ error: 'already_configured', message: 'A media server is already set up.' });
    return;
  }
  const { url, username, password } = b.data;
  let info;
  try {
    info = await jellyfin.embyProbe({ url });
  } catch (err) {
    res.status(502).json({ error: 'upstream', message: `Could not reach Emby: ${(err as Error).message}` });
    return;
  }
  const deviceId = newDeviceId();
  try {
    const auth = await jellyfin.embyAuthenticate(url, username, password, deviceId);
    if (!auth.User.Policy?.IsAdministrator) {
      await jellyfin.embyLogout(url, auth.AccessToken);
      res.status(403).json({ error: 'forbidden', message: 'Sign in with an Emby administrator account to set StreamForge up.' });
      return;
    }
    const apiKey = await jellyfin.embyCreateApiKey(url, auth.AccessToken);
    if (mediaReady()) {
      res.status(409).json({ error: 'already_configured', message: 'A media server is already set up.' });
      return;
    }
    const name = typeof info.meta?.server === 'string' ? info.meta.server : 'Emby';
    const existing = describeServers().find((s) => s.type === 'emby' && s.url === url);
    const srv = existing ? updateServer(existing.id, { apiKey, serverId: auth.ServerId, enabled: true })! : addServer({ type: 'emby', name, url, apiKey, serverId: auth.ServerId });
    setMainServer('emby', srv.id);
    audit({ ip: req.ip }, `[settings] Emby server “${name}” (${url}) set as the sign-in server during first-run setup`);
    const session = startSession(req, res, {
      userId: auth.User.Id,
      userName: auth.User.Name,
      isAdmin: true,
      primaryImageTag: auth.User.PrimaryImageTag,
      token: auth.AccessToken,
      deviceId,
      serverId: auth.ServerId,
      method: 'emby',
    });
    audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed in with Emby');
    res.json({ user: publicUser(session) });
  } catch (err) {
    const e = err as UpstreamError;
    if (e.status === 401) res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    else res.status(502).json({ error: 'upstream', message: `Could not finish setting up Emby: ${e.message}` });
  }
});

/** Signs in to the main Emby server with a name and password (from /login). */
async function signInWithEmby(req: Request, res: Response, username: string, password: string) {
  const srv = mainEmby()!;
  const deviceId = newDeviceId();
  try {
    const result = await jellyfin.embyAuthenticate(srv.url, username, password, deviceId);
    const isAdmin = !!result.User.Policy?.IsAdministrator;
    if (result.User.Policy?.IsDisabled || (!isAdmin && !membersCanSignIn())) {
      await jellyfin.embyLogout(srv.url, result.AccessToken);
      audit({ userId: result.User.Id, userName: result.User.Name, ip: req.ip }, '[auth] sign-in refused: member access is off', false);
      res.status(403).json({ error: 'forbidden', message: 'StreamForge is restricted to Emby administrators.' });
      return;
    }
    const data: SessionData = {
      userId: result.User.Id,
      userName: result.User.Name,
      isAdmin,
      primaryImageTag: result.User.PrimaryImageTag,
      token: result.AccessToken,
      deviceId,
      serverId: result.ServerId,
      method: 'emby',
    };
    if (mfaEnabled(data.userId)) {
      const challenge = randomBytes(24).toString('base64url');
      challenges.set(challenge, { data, expires: Date.now() + 5 * 60_000, attempts: 0 });
      res.json({ mfaRequired: true, challenge });
      return;
    }
    const session = startSession(req, res, data);
    audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed in with Emby');
    res.json({ user: publicUser(session) });
  } catch (err) {
    const e = err as UpstreamError;
    if (e.status === 401) {
      audit({ userName: username, ip: req.ip }, '[auth] sign-in failed: wrong username or password', false);
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    } else res.status(502).json({ error: 'upstream', message: `Could not reach Emby: ${e.message}` });
  }
}

/** Signs a Plex account in to the main Plex server, with two-factor when it's on. */
async function signInWithPlex(req: Request, res: Response, token: string) {
  const srv = mainPlex();
  if (!srv) {
    res.status(409).json({ error: 'not_plex', message: 'Plex isn’t the sign-in server.' });
    return;
  }
  // Older setups may not know the server's own id yet: ask the server.
  if (!srv.serverId) {
    const id = await plex.identity(srv.url);
    if (id) updateServer(srv.id, { serverId: id });
  }
  const serverId = getStoredServer(srv.id)?.serverId;
  const [who, access] = await Promise.all([plexAuth.account(token), serverId ? plexAuth.accessTo(token, serverId) : undefined]);
  const name = who.username || who.title || who.email || 'Plex user';
  if (!access) {
    audit({ userId: String(who.id), userName: name, ip: req.ip }, '[auth] Plex sign-in refused: no access to the server', false);
    res.status(403).json({ error: 'forbidden', message: `Your Plex account doesn’t have access to “${srv.name}”.` });
    return;
  }
  if (!access.isAdmin && !membersCanSignIn()) {
    audit({ userId: String(who.id), userName: name, ip: req.ip }, '[auth] sign-in refused: member access is off', false);
    res.status(403).json({ error: 'forbidden', message: 'StreamForge is restricted to the server’s owner.' });
    return;
  }
  if (who.thumb) plex.rememberAvatar(String(who.id), who.thumb);
  const data: SessionData = {
    userId: String(who.id),
    userName: name,
    isAdmin: access.isAdmin,
    primaryImageTag: who.thumb ? 'plex' : undefined,
    avatarUrl: who.thumb,
    token,
    serverToken: access.serverToken,
    deviceId: newDeviceId(),
    serverId,
    method: 'plex',
  };
  if (mfaEnabled(data.userId)) {
    const challenge = randomBytes(24).toString('base64url');
    challenges.set(challenge, { data, expires: Date.now() + 5 * 60_000, attempts: 0 });
    res.json({ mfaRequired: true, challenge });
    return;
  }
  const session = startSession(req, res, data);
  audit({ userId: session.userId, userName: session.userName, ip: req.ip }, '[auth] signed in with Plex');
  res.json({ user: publicUser(session) });
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = loginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: 'bad_request', message: 'Username is required' });
    return;
  }
  if (plexMode()) {
    res.status(409).json({ error: 'plex', message: 'Sign in with your Plex account.' });
    return;
  }
  if (mainEmby()) {
    await signInWithEmby(req, res, body.data.username, body.data.password);
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
        void remoteLogout(c.data);
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
    await remoteLogout(session);
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
  await remoteLogout(target);
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
      await remoteLogout(c.data);
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
  if (!oidcReady() || notJellyfinMain()) return loginError(res, 'Single sign-on isn’t set up.');
  try {
    res.redirect(302, await authorizeUrl(`${publicBase(req)}/api/auth/oidc/callback`));
  } catch (err) {
    loginError(res, `Couldn’t reach your identity provider: ${(err as Error).message}`);
  }
});

authRouter.get('/oidc/callback', setupLimiter, async (req, res) => {
  if (!oidcReady() || notJellyfinMain()) return loginError(res, 'Single sign-on isn’t set up.');
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

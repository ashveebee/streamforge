import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { db } from './db.js';

export interface Session {
  id: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
  primaryImageTag?: string;
  /** Jellyfin access token, or the Plex account token for Plex sign-ins. Never leaves the server. */
  token: string;
  /** Plex sign-ins: this user's token for the main Plex server. */
  serverToken?: string;
  /** Plex sign-ins: the account's avatar on plex.tv (proxied, never sent to the browser). */
  avatarUrl?: string;
  deviceId: string;
  serverId?: string;
  /** How the user signed in. */
  method?: 'password' | 'oidc' | 'plex';
  createdAt: number;
  expiresAt: number;
  lastValidatedAt: number;
  /** Last request seen, for the "signed-in devices" list. */
  lastSeenAt?: number;
  userAgent?: string;
}

export const SESSION_COOKIE = 'sf_session';

/**
 * Session store. Tokens stay on the server; the browser only ever holds an
 * opaque, random, HttpOnly session id. Sessions are kept in memory and
 * written through to SQLite (the database is owner-only, like the API keys
 * it already holds), so restarting or upgrading StreamForge keeps everyone
 * signed in.
 */
class SessionStore {
  private sessions = new Map<string, Session>();

  constructor() {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    for (const row of db.prepare('SELECT data FROM sessions').all() as { data: string }[]) {
      try {
        const s = JSON.parse(row.data) as Session;
        if (s.id && s.token && s.expiresAt > now) this.sessions.set(s.id, s);
      } catch {
        // Unreadable row: skip it, it will expire.
      }
    }
    setInterval(() => this.sweep(), 60_000).unref();
  }

  private persist(s: Session) {
    db.prepare(
      `INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
    ).run(s.id, JSON.stringify(s), s.expiresAt);
  }

  create(data: Omit<Session, 'id' | 'createdAt' | 'expiresAt' | 'lastValidatedAt'>): Session {
    const now = Date.now();
    const session: Session = {
      ...data,
      id: randomBytes(32).toString('base64url'),
      createdAt: now,
      expiresAt: now + config.sessionTtlMs,
      lastValidatedAt: now,
      lastSeenAt: now,
    };
    this.sessions.set(session.id, session);
    this.persist(session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.destroy(id);
      return undefined;
    }
    return s;
  }

  /** Saves changes made to a session object (re-validation, last seen, …). */
  save(s: Session) {
    if (this.sessions.has(s.id)) this.persist(s);
  }

  /** Records activity, writing at most once a minute per session. */
  touch(s: Session, userAgent?: string) {
    const now = Date.now();
    if (now - (s.lastSeenAt ?? 0) < 60_000 && (!userAgent || userAgent === s.userAgent)) return;
    s.lastSeenAt = now;
    if (userAgent) s.userAgent = userAgent.slice(0, 300);
    this.save(s);
  }

  destroy(id: string) {
    this.sessions.delete(id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  /** Every live session of a user. */
  forUser(userId: string) {
    return [...this.sessions.values()].filter((s) => s.userId === userId && s.expiresAt > Date.now());
  }

  all() {
    return [...this.sessions.values()].filter((s) => s.expiresAt > Date.now());
  }

  /** Signs everyone out (e.g. after switching to a different main server). */
  clear() {
    this.sessions.clear();
    db.prepare('DELETE FROM sessions').run();
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (s.expiresAt < now) this.sessions.delete(id);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  }
}

export const sessions = new SessionStore();
export const newDeviceId = () => createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 32);

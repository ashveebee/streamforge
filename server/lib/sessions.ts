import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';

export interface Session {
  id: string;
  userId: string;
  userName: string;
  isAdmin: boolean;
  primaryImageTag?: string;
  /** Jellyfin access token. Never leaves the server. */
  token: string;
  deviceId: string;
  serverId?: string;
  createdAt: number;
  expiresAt: number;
  lastValidatedAt: number;
}

export const SESSION_COOKIE = 'sf_session';

/**
 * In-memory session store. Tokens stay on the server; the browser only ever
 * holds an opaque, random, HttpOnly session id. Sessions are lost on restart,
 * which simply means users sign in again.
 */
class SessionStore {
  private sessions = new Map<string, Session>();

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(data: Omit<Session, 'id' | 'createdAt' | 'expiresAt' | 'lastValidatedAt'>): Session {
    const now = Date.now();
    const session: Session = {
      ...data,
      id: randomBytes(32).toString('base64url'),
      createdAt: now,
      expiresAt: now + config.sessionTtlMs,
      lastValidatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | undefined {
    if (!id) return undefined;
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  destroy(id: string) {
    this.sessions.delete(id);
  }

  /** Signs everyone out (e.g. after switching to a different Jellyfin server). */
  clear() {
    this.sessions.clear();
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (s.expiresAt < now) this.sessions.delete(id);
  }
}

export const sessions = new SessionStore();
export const newDeviceId = () => createHash('sha256').update(randomBytes(32)).digest('hex').slice(0, 32);

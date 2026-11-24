import type { Request } from 'express';
import { db } from './db.js';

/*
 * Audit log: a record of every change made through StreamForge — settings,
 * approvals, stream controls, queue actions, sign-ins — and who made it.
 * Entries are kept for 180 days.
 */

const RETENTION_MS = 180 * 86_400_000;

export interface AuditEntry {
  id: number;
  at: string;
  userId?: string;
  userName?: string;
  ip?: string;
  category: string;
  message: string;
  ok: boolean;
}

interface Actor {
  userId?: string;
  userName?: string;
  ip?: string;
}

const actorOf = (req: Request): Actor => ({ userId: req.session?.userId, userName: req.session?.userName, ip: req.ip });

/**
 * Records an action. `line` follows the log style `[category] what happened`;
 * it is also written to the console with the user's name.
 */
export function audit(req: Request | Actor | null, line: string, ok = true) {
  const actor: Actor = req && 'method' in req ? actorOf(req as Request) : ((req as Actor | null) ?? {});
  const m = line.match(/^\[([\w:-]+)\]\s*(.*)$/s);
  const category = (m?.[1] ?? 'app').split(':')[0]!;
  const message = (m?.[2] ?? line).slice(0, 1000);
  console.log(`[${m?.[1] ?? category}] ${message}${actor.userName ? ` by ${actor.userName}` : ''}`);
  try {
    db.prepare('INSERT INTO audit (at, user_id, user_name, ip, category, message, ok) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      Date.now(),
      actor.userId ?? null,
      actor.userName ?? null,
      actor.ip ?? null,
      category,
      message,
      ok ? 1 : 0,
    );
  } catch (err) {
    console.warn('[audit] could not record entry', err);
  }
}

interface Row {
  id: number;
  at: number;
  user_id: string | null;
  user_name: string | null;
  ip: string | null;
  category: string;
  message: string;
  ok: number;
}

export function auditEntries(opts: { category?: string; user?: string; q?: string; before?: number; limit?: number }) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.category) {
    where.push('category = ?');
    args.push(opts.category);
  }
  if (opts.user) {
    where.push('user_name = ?');
    args.push(opts.user);
  }
  if (opts.q) {
    where.push("(message LIKE ? ESCAPE '\\' OR user_name LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    args.push(like, like);
  }
  if (opts.before) {
    where.push('id < ?');
    args.push(opts.before);
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = db
    .prepare(`SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`)
    .all(...args, limit + 1) as unknown as Row[];
  const entries: AuditEntry[] = rows.slice(0, limit).map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    userId: r.user_id ?? undefined,
    userName: r.user_name ?? undefined,
    ip: r.ip ?? undefined,
    category: r.category,
    message: r.message,
    ok: !!r.ok,
  }));
  const facets = {
    categories: (db.prepare('SELECT DISTINCT category FROM audit ORDER BY category').all() as { category: string }[]).map((r) => r.category),
    users: (db.prepare('SELECT DISTINCT user_name FROM audit WHERE user_name IS NOT NULL ORDER BY user_name').all() as { user_name: string }[]).map(
      (r) => r.user_name,
    ),
  };
  return { entries, more: rows.length > limit, ...facets };
}

setInterval(() => db.prepare('DELETE FROM audit WHERE at < ?').run(Date.now() - RETENTION_MS), 6 * 3600_000).unref();

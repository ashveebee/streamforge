import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

/**
 * SQLite database for settings managed from the UI. Uses Node's built-in
 * `node:sqlite`, so there is no native module to compile per architecture.
 *
 * The file holds API keys, so the directory and file are owner-only.
 */
const dir = path.resolve(config.dataDir);
mkdirSync(dir, { recursive: true, mode: 0o700 });

export const dbPath = path.join(dir, 'streamforge.db');
export const db = new DatabaseSync(dbPath);
try {
  chmodSync(dbPath, 0o600);
} catch {
  // Best effort (e.g. filesystems without POSIX permissions).
}

db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

/** Ordered migrations; PRAGMA user_version records how many have run. */
const migrations = [
  `CREATE TABLE service_settings (
     service    TEXT PRIMARY KEY,
     data       TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT
   )`,
  // App-wide preferences (enabled services, auto-import options, …) as JSON.
  `CREATE TABLE app_settings (
     key        TEXT PRIMARY KEY,
     data       TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  // Playback history recorded from Jellyfin sessions (see services/playStats.ts).
  `CREATE TABLE plays (
     id          TEXT PRIMARY KEY,
     user_id     TEXT,
     user_name   TEXT,
     item_id     TEXT,
     title       TEXT NOT NULL,
     series      TEXT,
     type        TEXT,
     client      TEXT,
     device      TEXT,
     method      TEXT NOT NULL,
     started_at  INTEGER NOT NULL,
     last_seen   INTEGER NOT NULL,
     watched_ms  INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX plays_started ON plays(started_at);`,
  // Disk usage samples for the storage forecast (see services/storage.ts).
  `CREATE TABLE disk_samples (
     key    TEXT NOT NULL,
     label  TEXT NOT NULL,
     t      INTEGER NOT NULL,
     used   INTEGER NOT NULL,
     total  INTEGER NOT NULL,
     PRIMARY KEY (key, t)
   );
   CREATE INDEX disk_samples_t ON disk_samples(t);`,
  // Sign-in sessions, so a restart or upgrade doesn't sign everyone out.
  `CREATE TABLE sessions (
     id          TEXT PRIMARY KEY,
     data        TEXT NOT NULL,
     expires_at  INTEGER NOT NULL
   );
   CREATE INDEX sessions_expires ON sessions(expires_at);`,
  // Who did what (see lib/audit.ts).
  `CREATE TABLE audit (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     at         INTEGER NOT NULL,
     user_id    TEXT,
     user_name  TEXT,
     ip         TEXT,
     category   TEXT NOT NULL,
     message    TEXT NOT NULL,
     ok         INTEGER NOT NULL DEFAULT 1
   );
   CREATE INDEX audit_at ON audit(at);`,
  // Timeline samples for the buffering diagnosis (see services/diagnosis).
  `CREATE TABLE diag_ticks (
     t     INTEGER PRIMARY KEY,
     data  TEXT NOT NULL
   );`,
];

/** Reads a JSON preference, or `fallback` when missing or unreadable. */
export function readPref<T>(key: string, fallback: T): T {
  const row = db.prepare('SELECT data FROM app_settings WHERE key = ?').get(key) as { data: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  db.prepare(
    `INSERT INTO app_settings (key, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
for (let i = current; i < migrations.length; i++) {
  db.exec('BEGIN');
  try {
    db.exec(migrations[i]!);
    db.exec(`PRAGMA user_version = ${i + 1}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

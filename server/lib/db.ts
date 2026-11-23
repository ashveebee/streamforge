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
];

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

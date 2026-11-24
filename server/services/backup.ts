import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { db } from '../lib/db.js';
import { VERSION } from '../version.js';

/*
 * Settings backup and restore. A backup holds every saved setting (service
 * addresses and API keys, extra instances, download clients, notification
 * channels, rules, member access, …) and optionally the history tables
 * (plays, storage samples, audit log). It is encrypted with a passphrase
 * (scrypt + AES-256-GCM) because it contains credentials.
 *
 * Sign-in sessions are never included.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const KDF = { N: 2 ** 15, r: 8, p: 1 };
const FORMAT = 'streamforge-backup';

const TABLES = {
  service_settings: ['service', 'data', 'updated_at', 'updated_by'],
  app_settings: ['key', 'data', 'updated_at'],
  plays: ['id', 'user_id', 'user_name', 'item_id', 'title', 'series', 'type', 'client', 'device', 'method', 'started_at', 'last_seen', 'watched_ms'],
  disk_samples: ['key', 'label', 't', 'used', 'total'],
  audit: ['id', 'at', 'user_id', 'user_name', 'ip', 'category', 'message', 'ok'],
} as const;
type Table = keyof typeof TABLES;
const CONFIG: Table[] = ['service_settings', 'app_settings'];
const HISTORY: Table[] = ['plays', 'disk_samples', 'audit'];

async function key(passphrase: string, salt: Buffer) {
  return scrypt(passphrase.normalize('NFKC'), salt, 32, { ...KDF, maxmem: 128 * KDF.N * KDF.r * 2 });
}

export class BackupError extends Error {}

export async function createBackup(passphrase: string, includeHistory: boolean) {
  const tables = includeHistory ? [...CONFIG, ...HISTORY] : CONFIG;
  const data: Record<string, unknown[]> = {};
  for (const t of tables) data[t] = db.prepare(`SELECT ${TABLES[t].join(', ')} FROM ${t}`).all();
  const plain = Buffer.from(JSON.stringify({ tables: data }));
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(passphrase, salt), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    format: FORMAT,
    version: 1,
    appVersion: VERSION,
    createdAt: new Date().toISOString(),
    includes: tables,
    kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: enc.toString('base64'),
  };
}

interface BackupFile {
  format?: string;
  version?: number;
  kdf?: { salt?: string; N?: number; r?: number; p?: number };
  cipher?: { iv?: string; tag?: string };
  data?: string;
}

export async function restoreBackup(file: unknown, passphrase: string) {
  const f = file as BackupFile;
  if (!f || f.format !== FORMAT || f.version !== 1 || !f.kdf?.salt || !f.cipher?.iv || !f.cipher.tag || typeof f.data !== 'string') {
    throw new BackupError('This isn’t a StreamForge backup file.');
  }
  if (f.kdf.N !== KDF.N || f.kdf.r !== KDF.r || f.kdf.p !== KDF.p) throw new BackupError('Unsupported backup format.');
  let parsed: { tables: Partial<Record<Table, Record<string, unknown>[]>> };
  try {
    const d = createDecipheriv('aes-256-gcm', await key(passphrase, Buffer.from(f.kdf.salt, 'base64')), Buffer.from(f.cipher.iv, 'base64'));
    d.setAuthTag(Buffer.from(f.cipher.tag, 'base64'));
    const plain = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]);
    parsed = JSON.parse(plain.toString('utf8'));
  } catch {
    throw new BackupError('Wrong passphrase, or the file is damaged.');
  }
  const tables = Object.keys(parsed.tables ?? {}).filter((t): t is Table => t in TABLES);
  if (!tables.includes('service_settings') || !tables.includes('app_settings')) throw new BackupError('The backup has no settings in it.');

  const counts: Record<string, number> = {};
  db.exec('BEGIN');
  try {
    for (const t of tables) {
      const cols = TABLES[t];
      const rows = parsed.tables[t]!;
      if (!Array.isArray(rows)) throw new BackupError(`Damaged table ${t}`);
      db.exec(`DELETE FROM ${t}`);
      const insert = db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (const r of rows) {
        const values = cols.map((c) => {
          const v = r[c];
          if (v === undefined || v === null) return null;
          if (typeof v === 'string' || typeof v === 'number') return v;
          throw new BackupError(`Damaged value in ${t}.${c}`);
        });
        insert.run(...values);
      }
      counts[t] = rows.length;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err instanceof BackupError ? err : new BackupError(`Couldn’t restore: ${(err as Error).message}`);
  }
  return { counts, createdAt: (file as { createdAt?: string }).createdAt, appVersion: (file as { appVersion?: string }).appVersion };
}

/**
 * Settings are loaded into memory at start-up, so a restore takes effect on
 * restart. In a container with a restart policy we can do that ourselves.
 */
export const canSelfRestart = () => existsSync('/.dockerenv') || !!process.env.STREAMFORGE_SELF_RESTART;
export function restartSoon() {
  setTimeout(() => {
    console.log('[backup] restarting to apply the restored settings');
    process.exit(0);
  }, 1500).unref();
}

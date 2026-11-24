import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readPref, writePref } from '../lib/db.js';

/*
 * Two-factor sign-in with time-based one-time codes (RFC 6238: SHA-1, 30 s,
 * 6 digits), which every authenticator app supports. Each user turns it on
 * for themselves and gets ten single-use recovery codes. Secrets are stored
 * in the settings database alongside the API keys.
 */

interface MfaRecord {
  userName: string;
  secret: string;
  enabledAt: string;
  /** SHA-256 hashes of unused recovery codes. */
  recovery: string[];
  /** Last accepted time step, so a code can't be used twice. */
  lastStep?: number;
}

const PREF = 'mfa';
let records: Record<string, MfaRecord> = readPref<Record<string, MfaRecord>>(PREF, {});
const save = () => writePref(PREF, records);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(s: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: string, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

const step = (t = Date.now()) => Math.floor(t / 30_000);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The matching time step within ±1 step (clock drift), or undefined. */
function verifyTotp(secret: string, code: string) {
  const now = step();
  for (const s of [now, now - 1, now + 1]) if (same(hotp(secret, s), code)) return s;
  return undefined;
}

const hash = (code: string) => createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

export const mfaEnabled = (userId: string) => !!records[userId];
export const mfaInfo = (userId: string) => {
  const r = records[userId];
  return r ? { enabled: true, enabledAt: r.enabledAt, recoveryLeft: r.recovery.length } : { enabled: false };
};

/* ------------------------------- enrolment ------------------------------- */

const pending = new Map<string, { secret: string; expires: number }>();

export function beginSetup(userId: string, userName: string, issuer = 'StreamForge') {
  const secret = base32(randomBytes(20));
  pending.set(userId, { secret, expires: Date.now() + 15 * 60_000 });
  const label = encodeURIComponent(`${issuer}:${userName}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` };
}

export function finishSetup(userId: string, userName: string, code: string) {
  const p = pending.get(userId);
  if (!p || p.expires < Date.now()) return undefined;
  const s = verifyTotp(p.secret, code.replace(/\s/g, ''));
  if (s === undefined) return undefined;
  pending.delete(userId);
  const codes = Array.from({ length: 10 }, () => {
    const c = randomBytes(5).toString('hex');
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  records = { ...records, [userId]: { userName, secret: p.secret, enabledAt: new Date().toISOString(), recovery: codes.map(hash), lastStep: s } };
  save();
  return codes;
}

/** Checks a code (or recovery code) for a user; recovery codes are used up. */
export function verify(userId: string, code: string): 'totp' | 'recovery' | undefined {
  const r = records[userId];
  if (!r) return undefined;
  const clean = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(clean)) {
    const s = verifyTotp(r.secret, clean);
    if (s === undefined || (r.lastStep !== undefined && s <= r.lastStep)) return undefined;
    r.lastStep = s;
    save();
    return 'totp';
  }
  const h = hash(clean);
  const i = r.recovery.findIndex((x) => same(x, h));
  if (i < 0) return undefined;
  r.recovery.splice(i, 1);
  save();
  return 'recovery';
}

export function disable(userId: string) {
  if (!records[userId]) return false;
  const { [userId]: _, ...rest } = records;
  records = rest;
  save();
  return true;
}

/** Admin escape hatch: STREAMFORGE_RESET_2FA=<jellyfin user name> at start-up. */
export function resetByName(name: string) {
  const ids = Object.entries(records)
    .filter(([, r]) => r.userName.toLowerCase() === name.toLowerCase())
    .map(([id]) => id);
  for (const id of ids) disable(id);
  return ids.length;
}

export function mfaUsers() {
  return Object.entries(records).map(([userId, r]) => ({ userId, userName: r.userName, enabledAt: r.enabledAt }));
}

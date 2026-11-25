import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, readPref, writePref } from '../lib/db.js';
import { emit } from './notify.js';

/*
 * Kometa (formerly Plex Meta Manager) builds collections, overlays and
 * playlists on a schedule. It has no API, but it can send webhooks: at the
 * start and end of every run, on every error, when a newer version is out,
 * and when a collection changes. StreamForge gives Kometa a private address
 * to send them to and turns them into a status card and alerts.
 *
 * Kometa sends no credentials, so the address carries a long random token.
 * Payload reference: Kometa's modules/webhooks.py (event, start_time,
 * end_time, run_time, collections_*, items_*, error, critical, …).
 */

interface KometaSettings {
  enabled: boolean;
  token: string;
}

const PREF = 'kometa';
const newToken = () => randomBytes(24).toString('base64url');
let settings: KometaSettings = { enabled: false, token: newToken(), ...readPref<Partial<KometaSettings>>(PREF, {}) };
if (!readPref(PREF, null)) writePref(PREF, settings);

export const kometaSettings = () => settings;

export function updateKometa(patch: { enabled?: boolean; regenerate?: boolean }) {
  settings = { ...settings, ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }), ...(patch.regenerate ? { token: newToken() } : {}) };
  writePref(PREF, settings);
  return settings;
}

/** Constant-time check of the token in a webhook address. */
export function tokenMatches(token: string) {
  const a = Buffer.from(token);
  const b = Buffer.from(settings.token);
  return settings.enabled && a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------------------------- storage ---------------------------------- */

const KEEP = 1000;
const insert = db.prepare('INSERT INTO kometa_events (at, event, data) VALUES (?, ?, ?)');
const prune = db.prepare('DELETE FROM kometa_events WHERE id <= (SELECT id FROM kometa_events ORDER BY id DESC LIMIT 1 OFFSET ?)');

type Payload = Record<string, unknown>;

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Keeps only the fields StreamForge shows; drops embedded images and anything unexpected. */
function clean(p: Payload): Payload | undefined {
  const event = str(p.event, 20);
  const base = { server: str(p.server_name, 120), library: str(p.library_name, 120) };
  switch (event) {
    case 'run_start':
      return { event, startTime: str(p.start_time, 40) };
    case 'run_end':
      return {
        event,
        startTime: str(p.start_time, 40),
        endTime: str(p.end_time, 40),
        runTime: str(p.run_time, 40) ?? (num(p.run_time) !== undefined ? String(p.run_time) : undefined),
        created: num(p.collections_created) ?? 0,
        modified: num(p.collections_modified) ?? 0,
        deleted: num(p.collections_deleted) ?? 0,
        added: num(p.items_added) ?? 0,
        removed: num(p.items_removed) ?? 0,
        toRadarr: num(p.added_to_radarr) ?? 0,
        toSonarr: num(p.added_to_sonarr) ?? 0,
        collections: Array.isArray(p.names) ? p.names.length : undefined,
      };
    case 'error':
      return { event, ...base, error: str(p.error, 1000) ?? 'Unknown error', critical: p.critical === true, collection: str(p.collection, 200), playlist: str(p.playlist, 200) };
    case 'version':
      return { event, current: str(p.current, 60), latest: str(p.latest, 60) };
    case 'delete':
      return { event, ...base, message: str(p.message, 500) };
    case 'changes': {
      const titles = (v: unknown) => (Array.isArray(v) ? v.map((x) => str((x as Payload)?.title, 200)).filter(Boolean).slice(0, 20) : []);
      return {
        event,
        ...base,
        collection: str(p.collection, 200),
        playlist: str(p.playlist, 200),
        created: p.created === true,
        additions: titles(p.additions),
        removals: titles(p.removals),
        addedCount: Array.isArray(p.additions) ? p.additions.length : 0,
        removedCount: Array.isArray(p.removals) ? p.removals.length : 0,
      };
    }
    default:
      return undefined;
  }
}

/** Records a webhook from Kometa and raises alerts. False for payloads that aren't Kometa's. */
export function receive(p: Payload) {
  const e = clean(p);
  if (!e) return false;
  const now = Date.now();
  insert.run(now, e.event as string, JSON.stringify(e));
  prune.run(KEEP);

  if (e.event === 'error') {
    const where = [e.library, e.collection ?? e.playlist].filter(Boolean).join(' · ');
    emit('kometa_error', {
      title: `Kometa ${e.critical ? 'critical error' : 'error'}${where ? `: ${where}` : ''}`,
      message: String(e.error),
      url: '/system',
    });
  } else if (e.event === 'run_end') {
    const errors = errorsBetween(lastRunStart(now) ?? now - 24 * 3_600_000, now);
    emit('kometa_run', {
      title: errors ? `Kometa finished with ${errors} error${errors === 1 ? '' : 's'}` : 'Kometa finished a run',
      message: `${e.created} created, ${e.modified} updated, ${e.deleted} removed${e.runTime ? ` · took ${e.runTime}` : ''}`,
      url: '/system',
    });
  }
  return true;
}

/* ---------------------------------- status ---------------------------------- */

interface Row {
  id: number;
  at: number;
  event: string;
  data: string;
}

const parse = (r: Row) => ({ id: r.id, at: new Date(r.at).toISOString(), ...(JSON.parse(r.data) as Payload) });

function lastRunStart(before: number) {
  const r = db.prepare("SELECT at FROM kometa_events WHERE event = 'run_start' AND at <= ? ORDER BY id DESC LIMIT 1").get(before) as { at: number } | undefined;
  return r?.at;
}

function errorsBetween(from: number, to: number) {
  return (db.prepare("SELECT COUNT(*) AS n FROM kometa_events WHERE event = 'error' AND at >= ? AND at <= ?").get(from, to) as { n: number }).n;
}

const latest = (event: string) => db.prepare('SELECT * FROM kometa_events WHERE event = ? ORDER BY id DESC LIMIT 1').get(event) as Row | undefined;

/** What the Kometa card shows: whether a run is going, the last run and its errors, and recent changes. */
export function kometaStatus() {
  const start = latest('run_start');
  const end = latest('run_end');
  const running = !!start && (!end || end.id < start.id);
  // Errors from the current run, or the last one.
  const since = start?.at ?? 0;
  const errors = (db.prepare("SELECT * FROM kometa_events WHERE event = 'error' AND at >= ? ORDER BY id DESC LIMIT 20").all(since) as unknown as Row[]).map(parse);
  // Kometa announces a newer version at the start of each run; only the latest run's notice still applies.
  const v = latest('version');
  const version = v && start && v.id > start.id ? v : undefined;
  const changes = (db.prepare("SELECT * FROM kometa_events WHERE event IN ('changes', 'delete') ORDER BY id DESC LIMIT 12").all() as unknown as Row[]).map(parse);
  const runs = (db.prepare("SELECT * FROM kometa_events WHERE event = 'run_end' ORDER BY id DESC LIMIT 14").all() as unknown as Row[]).map((r) => {
    const d = parse(r);
    const from = lastRunStart(r.at) ?? r.at - 1;
    return { ...d, errors: errorsBetween(from, r.at) };
  });
  const total = (db.prepare('SELECT COUNT(*) AS n FROM kometa_events').get() as { n: number }).n;
  return {
    enabled: settings.enabled,
    /** Nothing has arrived yet: Kometa probably isn't pointed here. */
    waiting: total === 0,
    running,
    runningSince: running && start ? new Date(start.at).toISOString() : undefined,
    lastRun: runs[0],
    errors,
    version: version ? parse(version) : undefined,
    changes,
    runs,
  };
}

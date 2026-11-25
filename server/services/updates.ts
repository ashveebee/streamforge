import { config } from '../config.js';
import { readPref, writePref } from '../lib/db.js';
import { VERSION } from '../version.js';
import { emit } from './notify.js';

/*
 * Update check: is there a newer StreamForge release?
 *
 * Every 6 hours StreamForge asks GitHub's public API for the project's
 * recent releases. The request carries no information about this server
 * beyond the version number in the User-Agent. Admins see the new version in
 * the sidebar and Settings, with the changes since the running version, and
 * notification channels that subscribe to it hear about each version once.
 *
 * Turn it off with UPDATE_CHECK=false.
 */

const REPO = 'ashveebee/streamforge';
const EVERY_MS = 6 * 3600_000;

export interface Release {
  version: string;
  name: string;
  url: string;
  publishedAt: string;
  /** Release notes as sections of plain-text items. */
  notes: { heading: string; items: string[] }[];
}

interface State {
  checkedAt?: number;
  error?: string;
  /** Releases newer than the running version, newest first. */
  newer: Release[];
  /** The newest release overall, even if it's the running one. */
  latest?: string;
}

let state: State = { newer: [] };
let notified = readPref<string | null>('updateNotified', null);
let running: Promise<void> | undefined;

/** "v1.10.2" → [1, 10, 2]; anything unparseable sorts as 0.0.0. */
function parse(v: string) {
  const m = v.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
export function compareVersions(a: string, b: string) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** Release-please notes → sections of items, without commit links or markdown. */
export function parseNotes(body: string): Release['notes'] {
  const sections: Release['notes'] = [];
  let current: Release['notes'][number] | undefined;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^#{3,4}\s+(.+)$/);
    if (heading) {
      current = { heading: plain(heading[1]!), items: [] };
      sections.push(current);
      continue;
    }
    const item = line.match(/^[*-]\s+(.+)$/);
    if (item) {
      if (!current) {
        current = { heading: 'Changes', items: [] };
        sections.push(current);
      }
      const text = plain(item[1]!.replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/i, '').replace(/\s*\(#\d+\)\s*$/, ''));
      if (text) current.items.push(text.charAt(0).toUpperCase() + text.slice(1));
    }
  }
  return sections.filter((s) => s.items.length);
}

const plain = (s: string) =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .trim();

interface GhRelease {
  tag_name: string;
  name?: string;
  html_url: string;
  published_at: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
}

async function fetchReleases(): Promise<GhRelease[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `StreamForge/${VERSION}` },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is rate-limiting update checks; will try again later' : `GitHub answered ${res.status}`);
  return (await res.json()) as GhRelease[];
}

export async function checkForUpdates() {
  if (!config.updateCheck) return;
  running ??= (async () => {
    try {
      const releases = (await fetchReleases())
        .filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+/.test(r.tag_name))
        .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
      const newer = releases
        .filter((r) => compareVersions(r.tag_name, VERSION) > 0)
        .map((r) => ({
          version: r.tag_name.replace(/^v/i, ''),
          name: r.name || r.tag_name,
          url: r.html_url,
          publishedAt: r.published_at,
          notes: parseNotes(r.body ?? ''),
        }));
      state = { checkedAt: Date.now(), newer, latest: releases[0]?.tag_name.replace(/^v/i, '') };
      const top = newer[0];
      if (top && notified !== top.version) {
        notified = top.version;
        writePref('updateNotified', notified);
        emit('update_available', {
          title: `StreamForge ${top.version} is available`,
          message: `You’re running ${VERSION}. ${summary(newer)}`,
          url: '/settings#updates',
        });
      }
    } catch (err) {
      state = { ...state, checkedAt: Date.now(), error: (err as Error).message };
    } finally {
      running = undefined;
    }
  })();
  return running;
}

/** "3 new features and 2 fixes." */
function summary(newer: Release[]) {
  const count = (re: RegExp) => newer.flatMap((r) => r.notes.filter((n) => re.test(n.heading)).flatMap((n) => n.items)).length;
  const f = count(/feature/i);
  const b = count(/fix/i);
  const parts = [f && `${f} new feature${f === 1 ? '' : 's'}`, b && `${b} fix${b === 1 ? '' : 'es'}`].filter(Boolean);
  return parts.length ? `${parts.join(' and ')}.` : 'See what’s new in Settings.';
}

export function updateStatus() {
  return {
    enabled: config.updateCheck,
    current: VERSION,
    latest: state.latest,
    available: state.newer[0]?.version,
    releases: state.newer,
    checkedAt: state.checkedAt,
    error: state.error,
    repoUrl: `https://github.com/${REPO}/releases`,
  };
}

let lastManual = 0;
/** "Check now" from Settings, at most once a minute. */
export async function checkNow() {
  if (Date.now() - lastManual > 60_000) {
    lastManual = Date.now();
    await checkForUpdates();
  }
  return updateStatus();
}

export function startUpdateCheck() {
  if (!config.updateCheck) return;
  // A little after start-up, so a restart loop doesn't hammer GitHub.
  setTimeout(() => void checkForUpdates(), 60_000).unref();
  setInterval(() => void checkForUpdates(), EVERY_MS).unref();
}

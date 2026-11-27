import { randomBytes } from 'node:crypto';
import { audit } from '../lib/audit.js';
import { readPref, writePref } from '../lib/db.js';
import { cache } from '../lib/cache.js';
import { healthSnapshot } from '../health.js';
import { adapterFor, clientsSnapshot, enabledClients } from './clients/index.js';
import { runCleanup, stalledMap } from './cleanup.js';
import { arrInstances } from './instances.js';
import { jf, serverApiKey, type JfCtx } from './jellyfin.js';
import { mainNowPlaying, mainSilo, notJellyfinMain } from './mainServer.js';
import { emit } from './notify.js';
import { reclaimSuggestions } from './reclaim.js';
import { seerr } from './seerr.js';
import { requestSource } from './requestSource.js';
import * as silo from './silo.js';
import { storageForecast } from './storage.js';

/*
 * Rules: "if <condition> then <actions>". Every rule is checked every five
 * minutes. A rule fires when its condition becomes true; while it stays
 * true it fires again only after its cooldown (0 = once until it clears).
 *
 * Conditions read data StreamForge already collects. Actions are limited to
 * reversible or low-risk ones: notify, run the stalled-download cleanup,
 * pause or resume download clients, and stop monitoring titles. Nothing is
 * ever deleted by a rule.
 */

export const CONDITIONS = {
  disk_usage: { label: 'A volume is more than N% full', param: { name: 'percent', min: 50, max: 99, default: 90, unit: '%' } },
  disk_days_left: { label: 'A volume will be full in under N days', param: { name: 'days', min: 1, max: 365, default: 14, unit: 'days' } },
  service_offline: { label: 'A service has been offline for N minutes', param: { name: 'minutes', min: 1, max: 1440, default: 15, unit: 'minutes' } },
  stalled_downloads: { label: 'At least N downloads are stalled', param: { name: 'count', min: 1, max: 100, default: 3, unit: 'downloads' } },
  pending_requests: { label: 'At least N requests are waiting for approval', param: { name: 'count', min: 1, max: 500, default: 5, unit: 'requests' } },
  active_streams: { label: 'At least N streams are playing', param: { name: 'count', min: 1, max: 100, default: 5, unit: 'streams' } },
  ended_unwatched: { label: 'Ended series nobody has watched in N days', param: { name: 'days', min: 30, max: 1460, default: 180, unit: 'days' } },
} as const;
export type ConditionType = keyof typeof CONDITIONS;
export const CONDITION_TYPES = Object.keys(CONDITIONS) as ConditionType[];

export const ACTIONS = {
  notify: { label: 'Send a notification', for: 'all' },
  pause_downloads: { label: 'Pause all download clients', for: ['disk_usage', 'disk_days_left', 'active_streams'] },
  resume_downloads: { label: 'Resume all download clients', for: 'all' },
  run_cleanup: { label: 'Run the stalled-download cleanup', for: ['stalled_downloads'] },
  unmonitor: { label: 'Stop monitoring those series in Sonarr', for: ['ended_unwatched'] },
} as const;
export type ActionType = keyof typeof ACTIONS;
export const ACTION_TYPES = Object.keys(ACTIONS) as ActionType[];

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  condition: ConditionType;
  value: number;
  actions: ActionType[];
  /** Hours before firing again while still true; 0 = once until it clears. */
  cooldownHours: number;
  createdAt: string;
}

interface RuleState {
  lastCheck?: string;
  matched?: boolean;
  summary?: string;
  lastFired?: string;
  lastError?: string;
}

interface Result {
  matched: boolean;
  summary: string;
  /** Sonarr series to unmonitor (ended_unwatched). */
  series?: { instance: string; id: number; title: string }[];
}

let rules: Rule[] = readPref<Rule[]>('rules', []);
const state = new Map<string, RuleState>(Object.entries(readPref<Record<string, RuleState>>('rulesState', {})));
const persistState = () => writePref('rulesState', Object.fromEntries(state));

/* ------------------------------- conditions ------------------------------- */

const offlineSince = new Map<string, number>();

/** A context for Jellyfin calls with the server API key and an admin's id. */
async function serverCtx(): Promise<JfCtx | undefined> {
  // With Plex as the sign-in server, library reads use the main Plex server's own token.
  if (notJellyfinMain()) return { token: '', deviceId: 'streamforge-server', userId: '' };
  const key = serverApiKey();
  if (!key) return undefined;
  const users = await cache.get('jf:users:admins', 60 * 60_000, () => jf<{ Id: string; Policy?: { IsAdministrator?: boolean } }[]>('/Users', key, 'streamforge-server'));
  const admin = users.find((u) => u.Policy?.IsAdministrator);
  return admin ? { token: key, deviceId: 'streamforge-server', userId: admin.Id } : undefined;
}

async function evaluate(r: Rule): Promise<Result> {
  const n = r.value;
  switch (r.condition) {
    case 'disk_usage': {
      const hit = storageForecast().volumes.filter((v) => v.usage * 100 >= n);
      return { matched: hit.length > 0, summary: hit.length ? hit.map((v) => `${v.label} is ${Math.round(v.usage * 100)}% full`).join('; ') : `Every volume is under ${n}%` };
    }
    case 'disk_days_left': {
      const hit = storageForecast().volumes.filter((v) => v.daysLeft !== undefined && v.daysLeft < n);
      return { matched: hit.length > 0, summary: hit.length ? hit.map((v) => `${v.label} full in about ${v.daysLeft} days`).join('; ') : `No volume fills up within ${n} days` };
    }
    case 'service_offline': {
      const now = Date.now();
      const down: string[] = [];
      for (const s of healthSnapshot().services) {
        if (s.status === 'offline') {
          const since = offlineSince.get(s.id) ?? now;
          offlineSince.set(s.id, since);
          if (now - since >= n * 60_000) down.push(`${s.name} (${Math.round((now - since) / 60_000)} min)`);
        } else offlineSince.delete(s.id);
      }
      for (const c of clientsSnapshot().clients) if (!c.online && c.lastSuccess && now - Date.parse(c.lastSuccess) >= n * 60_000) down.push(c.name);
      return { matched: down.length > 0, summary: down.length ? `Offline: ${down.join(', ')}` : 'Everything is online' };
    }
    case 'stalled_downloads': {
      const count = Object.keys(stalledMap()).length;
      return { matched: count >= n, summary: `${count} download${count === 1 ? ' is' : 's are'} stalled` };
    }
    case 'pending_requests': {
      const source = await requestSource();
      if (!source) return { matched: false, summary: 'Requests aren’t set up' };
      const si = source === 'silo' ? mainSilo() : undefined;
      const c = si ? { pending: (await silo.pendingRequests(si)).length } : await seerr()!.get<{ pending: number }>('/api/v1/request/count');
      return { matched: c.pending >= n, summary: `${c.pending} request${c.pending === 1 ? '' : 's'} waiting` };
    }
    case 'active_streams': {
      const streams = await mainNowPlaying();
      if (!streams) return { matched: false, summary: 'Needs a Jellyfin API key' };
      return { matched: streams.length >= n, summary: `${streams.length} stream${streams.length === 1 ? '' : 's'} playing` };
    }
    case 'ended_unwatched': {
      const ctx = await serverCtx();
      if (!ctx) return { matched: false, summary: 'Needs a Jellyfin API key' };
      const res = await reclaimSuggestions(ctx, n >= 730 ? 730 : n >= 365 ? 365 : n >= 180 ? 180 : 90);
      const cutoff = Date.now() - n * 86_400_000;
      const series = res.items.filter((i) => i.kind === 'series' && i.ended && (!i.lastWatched || Date.parse(i.lastWatched) < cutoff));
      // Only monitored ones are worth acting on.
      const monitored: Result['series'] = [];
      for (const inst of arrInstances('sonarr')) {
        const all = await cache.get(`${inst.id}:series`, 60_000, () => inst.client.get<{ id: number; monitored: boolean }[]>('/api/v3/series')).catch(() => []);
        const on = new Set(all.filter((s) => s.monitored).map((s) => s.id));
        for (const s of series) if (s.instance === inst.id && on.has(s.arrId)) monitored.push({ instance: inst.id, id: s.arrId, title: s.title });
      }
      return {
        matched: monitored.length > 0,
        summary: monitored.length ? `${monitored.length} ended series unwatched for ${n}+ days: ${monitored.slice(0, 8).map((s) => s.title).join(', ')}${monitored.length > 8 ? '…' : ''}` : 'None',
        series: monitored,
      };
    }
  }
}

/* --------------------------------- actions --------------------------------- */

async function act(r: Rule, res: Result) {
  const done: string[] = [];
  for (const a of r.actions) {
    switch (a) {
      case 'notify':
        emit('rule', { title: r.name, message: res.summary, url: '/rules' });
        done.push('notified');
        break;
      case 'pause_downloads':
      case 'resume_downloads':
        for (const c of enabledClients()) await adapterFor(c).setPaused(a === 'pause_downloads').catch(() => undefined);
        done.push(a === 'pause_downloads' ? 'paused downloads' : 'resumed downloads');
        break;
      case 'run_cleanup': {
        const out = await runCleanup();
        done.push(`cleanup removed ${out.filter((e) => e.outcome === 'done').length}`);
        break;
      }
      case 'unmonitor':
        for (const s of res.series ?? []) {
          const inst = arrInstances('sonarr').find((i) => i.id === s.instance);
          if (!inst) continue;
          const full = await inst.client.get<Record<string, unknown>>(`/api/v3/series/${s.id}`);
          await inst.client.put(`/api/v3/series/${s.id}`, { ...full, monitored: false });
        }
        cache.delete('sonarr');
        done.push(`unmonitored ${res.series?.length ?? 0} series`);
        break;
    }
  }
  audit(null, `[rules] “${r.name}” fired: ${res.summary} → ${done.join(', ') || 'no actions'}`);
}

async function check(r: Rule, opts: { force?: boolean } = {}) {
  const s = state.get(r.id) ?? {};
  state.set(r.id, s);
  s.lastCheck = new Date().toISOString();
  try {
    const res = await evaluate(r);
    const was = s.matched;
    s.matched = res.matched;
    s.summary = res.summary;
    s.lastError = undefined;
    const cooled = r.cooldownHours > 0 && s.lastFired && Date.now() - Date.parse(s.lastFired) >= r.cooldownHours * 3_600_000;
    if (res.matched && (opts.force || !was || cooled)) {
      s.lastFired = new Date().toISOString();
      await act(r, res);
    }
  } catch (err) {
    s.lastError = (err as Error).message;
  }
  persistState();
  return s;
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    for (const r of rules) if (r.enabled) await check(r);
  } finally {
    running = false;
  }
}

export function startRules() {
  setTimeout(() => void tick(), 60_000).unref();
  setInterval(() => void tick(), 5 * 60_000).unref();
}

/* ------------------------------- management ------------------------------- */

export function rulesStatus() {
  return {
    rules: rules.map((r) => ({ ...r, state: state.get(r.id) ?? {} })),
    conditions: CONDITIONS,
    actions: Object.fromEntries(ACTION_TYPES.map((a) => [a, { label: ACTIONS[a].label, for: ACTIONS[a].for === 'all' ? null : ACTIONS[a].for }])),
  };
}

export class RuleError extends Error {}

function validate(input: Omit<Rule, 'id' | 'createdAt'>) {
  const c = CONDITIONS[input.condition];
  if (!c) throw new RuleError('Unknown condition');
  if (input.value < c.param.min || input.value > c.param.max) throw new RuleError(`Pick a value between ${c.param.min} and ${c.param.max}`);
  for (const a of input.actions) {
    const allowed = ACTIONS[a]?.for;
    if (!allowed || (allowed !== 'all' && !(allowed as readonly string[]).includes(input.condition))) throw new RuleError(`“${ACTIONS[a]?.label ?? a}” doesn’t apply to this condition`);
  }
  if (!input.actions.length) throw new RuleError('Pick at least one action');
}

export function saveRule(input: Omit<Rule, 'id' | 'createdAt'> & { id?: string }) {
  validate(input);
  const cur = input.id ? rules.find((r) => r.id === input.id) : undefined;
  if (input.id && !cur) throw new RuleError('Unknown rule');
  const rule: Rule = { ...input, name: input.name.trim() || CONDITIONS[input.condition].label, id: cur?.id ?? randomBytes(5).toString('hex'), createdAt: cur?.createdAt ?? new Date().toISOString() };
  rules = cur ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule];
  // A changed rule starts fresh.
  if (cur && (cur.condition !== rule.condition || cur.value !== rule.value)) state.delete(rule.id);
  writePref('rules', rules);
  persistState();
  return rule;
}

export function removeRule(id: string) {
  const before = rules.length;
  rules = rules.filter((r) => r.id !== id);
  state.delete(id);
  writePref('rules', rules);
  persistState();
  return rules.length !== before;
}

/** Evaluates a rule now. With `fire`, its actions run if it matches. */
export async function runRule(id: string, fire: boolean) {
  const r = rules.find((x) => x.id === id);
  if (!r) throw new RuleError('Unknown rule');
  if (!fire) {
    const res = await evaluate(r);
    return { matched: res.matched, summary: res.summary };
  }
  const s = await check(r, { force: true });
  return { matched: !!s.matched, summary: s.summary ?? '', error: s.lastError };
}

import { createHmac, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { readPref, writePref } from '../lib/db.js';
import { requestRaw, UpstreamError } from '../lib/http.js';
import { keyHint } from '../settings.js';
import { VERSION } from '../version.js';

/*
 * Notifications. Features call `emit(type, payload)`; every enabled channel
 * subscribed to that event type gets a message. Channels:
 *
 *   discord   – a Discord webhook URL
 *   ntfy      – an ntfy topic (ntfy.sh or self-hosted), optional token
 *   pushover  – Pushover user key + application token
 *   webhook   – JSON POST to any URL, optionally HMAC-signed
 *   webpush   – browser/phone push to devices that opted in (PWA)
 *
 * Secrets (webhook URLs, tokens) stay on the server; the API only returns
 * short hints. Identical messages within 10 minutes are sent once.
 */

export const EVENT_TYPES = [
  'service_down',
  'service_up',
  'disk_low',
  'import_done',
  'import_failed',
  'download_removed',
  'request_pending',
  'playback_alert',
  'weekly_digest',
  'rule',
  'update_available',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const CHANNEL_TYPES = ['discord', 'ntfy', 'pushover', 'webhook', 'webpush'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export interface EventPayload {
  title: string;
  message: string;
  /** App path to open, e.g. `/sonarr`. */
  url?: string;
}

/** Field values per type. Keys listed in SECRET_FIELDS are never returned. */
export type ChannelConfig = Record<string, string>;
const SECRET_FIELDS: Record<ChannelType, string[]> = {
  discord: ['webhookUrl'],
  ntfy: ['token'],
  pushover: ['userKey', 'appToken'],
  webhook: ['secret'],
  webpush: [],
};
const REQUIRED: Record<ChannelType, string[]> = {
  discord: ['webhookUrl'],
  ntfy: ['topic'],
  pushover: ['userKey', 'appToken'],
  webhook: ['url'],
  webpush: [],
};

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: EventType[];
  config: ChannelConfig;
}

interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  user: string;
  device?: string;
  createdAt: string;
}

export interface Delivery {
  at: string;
  channel: string;
  event: EventType | 'test';
  title: string;
  ok: boolean;
  error?: string;
}

const DEFAULT_EVENTS: EventType[] = ['service_down', 'service_up', 'disk_low', 'import_failed', 'download_removed', 'request_pending'];

let channels: Channel[] = readPref<Channel[]>('notifyChannels', []);
let subs: PushSub[] = readPref<PushSub[]>('pushSubscriptions', []);
const deliveries: Delivery[] = [];
const recent = new Map<string, number>();

/* ---------------------------------- push --------------------------------- */

function vapid() {
  let keys = readPref<{ publicKey: string; privateKey: string } | null>('vapid', null);
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    writePref('vapid', keys);
  }
  return keys;
}

export const pushPublicKey = () => vapid().publicKey;

export function addPushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, user: string, device?: string) {
  subs = [...subs.filter((s) => s.endpoint !== sub.endpoint), { ...sub, user, device, createdAt: new Date().toISOString() }];
  writePref('pushSubscriptions', subs);
  // The first device to opt in gets a push channel to go with it.
  if (!channels.some((c) => c.type === 'webpush')) {
    saveChannel({ type: 'webpush', name: 'Browser & phone push', enabled: true, events: DEFAULT_EVENTS, config: {} });
  }
}

export function removePushSubscription(endpoint: string) {
  subs = subs.filter((s) => s.endpoint !== endpoint);
  writePref('pushSubscriptions', subs);
}

export const hasPushSubscription = (endpoint: string) => subs.some((s) => s.endpoint === endpoint);

async function sendPush(p: EventPayload) {
  if (!subs.length) throw new Error('No devices have turned on push notifications');
  const { publicKey, privateKey } = vapid();
  const body = JSON.stringify({ title: p.title, body: p.message, url: p.url ?? '/' });
  const gone: string[] = [];
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, body, {
          TTL: 3600,
          vapidDetails: { subject: 'https://github.com/ashveebee/streamforge', publicKey, privateKey },
        });
        ok++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.endpoint);
      }
    }),
  );
  if (gone.length) {
    subs = subs.filter((s) => !gone.includes(s.endpoint));
    writePref('pushSubscriptions', subs);
  }
  if (!ok) throw new Error('No device accepted the notification');
}

/* -------------------------------- senders -------------------------------- */

const absolute = (url?: string) => {
  const base = readPref<string | null>('publicUrl', null);
  return url && base ? new URL(url, base).toString() : undefined;
};

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await requestRaw(url, { method: 'POST', body, headers, timeoutMs: 10_000 });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new UpstreamError(`HTTP ${res.status}${text && text.length < 200 ? `: ${text}` : ''}`, res.status);
  }
}

async function deliver(c: Channel, event: EventType | 'test', p: EventPayload) {
  const link = absolute(p.url);
  switch (c.type) {
    case 'discord':
      return post(c.config.webhookUrl!, {
        username: 'StreamForge',
        embeds: [{ title: p.title, description: p.message.slice(0, 4000), url: link, color: COLORS[event], timestamp: new Date().toISOString() }],
      });
    case 'ntfy': {
      const server = (c.config.server || 'https://ntfy.sh').replace(/\/+$/, '');
      const res = await requestRaw(`${server}/${encodeURIComponent(c.config.topic!)}`, {
        method: 'POST',
        timeoutMs: 10_000,
        headers: {
          // ntfy takes the body as plain text; JSON would be sent verbatim.
          'Content-Type': 'text/plain; charset=utf-8',
          Title: encodeHeader(p.title),
          Tags: TAGS[event],
          Priority: event === 'service_down' || event === 'disk_low' ? '4' : '3',
          ...(link ? { Click: link } : {}),
          ...(c.config.token ? { Authorization: `Bearer ${c.config.token}` } : {}),
        },
        rawBody: p.message,
      });
      if (!res.ok) throw new UpstreamError(`HTTP ${res.status}`, res.status);
      return;
    }
    case 'pushover':
      return post('https://api.pushover.net/1/messages.json', {
        token: c.config.appToken,
        user: c.config.userKey,
        title: p.title,
        message: p.message,
        ...(link ? { url: link, url_title: 'Open StreamForge' } : {}),
        priority: event === 'service_down' ? 1 : 0,
      });
    case 'webhook': {
      const body = { event, title: p.title, message: p.message, url: link ?? p.url, at: new Date().toISOString(), source: `StreamForge/${VERSION}` };
      const headers: Record<string, string> = {};
      if (c.config.secret) {
        headers['X-StreamForge-Signature'] = `sha256=${createHmac('sha256', c.config.secret).update(JSON.stringify(body)).digest('hex')}`;
      }
      return post(c.config.url!, body, headers);
    }
    case 'webpush':
      return sendPush(p);
  }
}

/** Header values must be ISO-8859-1; ntfy accepts RFC 2047 for anything else. */
function encodeHeader(v: string) {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`;
}

const COLORS: Record<EventType | 'test', number> = {
  service_down: 0xfb7185,
  service_up: 0x34d399,
  disk_low: 0xfbbf24,
  import_done: 0x34d399,
  import_failed: 0xfb7185,
  download_removed: 0xfbbf24,
  request_pending: 0x818cf8,
  playback_alert: 0xfbbf24,
  weekly_digest: 0x22d3ee,
  rule: 0xa78bfa,
  update_available: 0x818cf8,
  test: 0xa78bfa,
};
const TAGS: Record<EventType | 'test', string> = {
  service_down: 'rotating_light',
  service_up: 'white_check_mark',
  disk_low: 'floppy_disk',
  import_done: 'inbox_tray',
  import_failed: 'warning',
  download_removed: 'wastebasket',
  request_pending: 'raising_hand',
  playback_alert: 'film_projector',
  weekly_digest: 'newspaper',
  rule: 'robot',
  update_available: 'sparkles',
  test: 'wave',
};

function remember(d: Delivery) {
  deliveries.unshift(d);
  deliveries.splice(50);
}

/* --------------------------------- emit ---------------------------------- */

/** Sends an event to every subscribed channel. Never throws. */
export function emit(type: EventType, payload: EventPayload) {
  const key = `${type}|${payload.title}|${payload.message}`;
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - 10 * 60_000) return;
  recent.set(key, now);
  for (const [k, t] of recent) if (t < now - 10 * 60_000) recent.delete(k);

  for (const c of channels) {
    if (!c.enabled || !c.events.includes(type)) continue;
    void deliver(c, type, payload).then(
      () => remember({ at: new Date().toISOString(), channel: c.name, event: type, title: payload.title, ok: true }),
      (err) => {
        console.warn(`[notify] ${c.name}: ${(err as Error).message}`);
        remember({ at: new Date().toISOString(), channel: c.name, event: type, title: payload.title, ok: false, error: (err as Error).message });
      },
    );
  }
}

/* ------------------------------- management ------------------------------ */

export function describeChannel(c: Channel) {
  const config: Record<string, string> = {};
  const secrets: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(c.config)) {
    if (SECRET_FIELDS[c.type].includes(k)) secrets[k] = v ? (k === 'webhookUrl' ? discordHint(v) : keyHint(v)) : undefined;
    else config[k] = v;
  }
  return { id: c.id, type: c.type, name: c.name, enabled: c.enabled, events: c.events, config, secrets };
}

function discordHint(url: string) {
  const m = url.match(/webhooks\/(\d+)\//);
  return m ? `webhook …${m[1]!.slice(-4)}` : '••••';
}

export function notificationsStatus() {
  return {
    channels: channels.map(describeChannel),
    events: EVENT_TYPES,
    defaultEvents: DEFAULT_EVENTS,
    deliveries,
    push: { publicKey: pushPublicKey(), devices: subs.length },
    publicUrl: readPref<string | null>('publicUrl', null) ?? '',
  };
}

export function setPublicUrl(url: string) {
  writePref('publicUrl', url || null);
}

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/** Creates or updates a channel. Blank secret fields keep the saved value. */
export function saveChannel(input: { id?: string; type: ChannelType; name: string; enabled: boolean; events: EventType[]; config: ChannelConfig }) {
  const cur = input.id ? channels.find((c) => c.id === input.id) : undefined;
  if (input.id && !cur) throw new ChannelError('Unknown channel');
  const config: ChannelConfig = {};
  for (const [k, v] of Object.entries(input.config)) if (v.trim()) config[k] = v.trim();
  if (cur) for (const k of SECRET_FIELDS[cur.type]) if (!config[k] && cur.config[k] && input.config[k] === undefined) config[k] = cur.config[k]!;
  for (const k of REQUIRED[input.type]) if (!config[k]) throw new ChannelError('This field is required', k);
  validate(input.type, config);
  const ch: Channel = { id: cur?.id ?? randomBytes(6).toString('hex'), type: input.type, name: input.name.trim() || input.type, enabled: input.enabled, events: input.events, config };
  channels = cur ? channels.map((c) => (c.id === ch.id ? ch : c)) : [...channels, ch];
  writePref('notifyChannels', channels);
  return ch;
}

function validate(type: ChannelType, c: ChannelConfig) {
  const https = (field: string, re?: RegExp, msg = 'Enter a valid https:// address') => {
    const v = c[field];
    if (v === undefined) return;
    try {
      const u = new URL(v);
      if (!/^https?:$/.test(u.protocol) || (re && !re.test(v))) throw new Error();
    } catch {
      throw new ChannelError(msg, field);
    }
  };
  if (type === 'discord') https('webhookUrl', /^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//, 'Paste the webhook URL from Discord’s channel settings');
  if (type === 'ntfy') {
    https('server');
    if (c.topic && !/^[\w-]{1,64}$/.test(c.topic)) throw new ChannelError('Topics may only contain letters, numbers, - and _', 'topic');
  }
  if (type === 'webhook') https('url');
}

export function removeChannel(id: string) {
  const before = channels.length;
  channels = channels.filter((c) => c.id !== id);
  writePref('notifyChannels', channels);
  return channels.length !== before;
}

/** Sends a test message through a saved channel. */
export async function testChannel(id: string) {
  const c = channels.find((x) => x.id === id);
  if (!c) throw new ChannelError('Unknown channel');
  const p = { title: 'StreamForge test notification', message: 'If you can read this, notifications are working.', url: '/settings' };
  try {
    await deliver(c, 'test', p);
    remember({ at: new Date().toISOString(), channel: c.name, event: 'test', title: p.title, ok: true });
  } catch (err) {
    remember({ at: new Date().toISOString(), channel: c.name, event: 'test', title: p.title, ok: false, error: (err as Error).message });
    throw err;
  }
}

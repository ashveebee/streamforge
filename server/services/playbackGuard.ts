import { readPref, writePref } from '../lib/db.js';
import { emit } from './notify.js';
import type { NowPlaying } from './jellyfin.js';
import { controlMainSession, mainNowPlaying, plexMode } from './mainServer.js';

/*
 * Playback guard: watches active streams (needs the Jellyfin API key) and
 * alerts when transcoding or bandwidth goes over limits an admin set:
 *
 *  - more than N streams transcoding at once
 *  - a 4K source being transcoded (usually a client that can't play it)
 *  - total streaming bandwidth over a threshold
 *
 * For 4K transcodes it can also send the viewer a polite message
 * suggesting a client that plays the file directly.
 */

export interface GuardSettings {
  enabled: boolean;
  /** 0 = no limit. */
  maxTranscodes: number;
  fourK: 'off' | 'alert' | 'message';
  /** Total Mbit/s across streams; 0 = no limit. */
  maxMbps: number;
  message: string;
}

const DEFAULTS: GuardSettings = {
  enabled: false,
  maxTranscodes: 3,
  fourK: 'alert',
  maxMbps: 0,
  message: 'This 4K title is being converted for your device, which strains the server. If you can, please watch it on a TV or app that plays 4K directly.',
};

let settings: GuardSettings = { ...DEFAULTS, ...readPref<Partial<GuardSettings>>('playbackGuard', {}) };
export const guardSettings = () => settings;
export function updateGuard(patch: Partial<GuardSettings>) {
  settings = { ...settings, ...patch };
  writePref('playbackGuard', settings);
  return guardStatus();
}

interface Alert {
  at: string;
  kind: 'transcodes' | '4k' | 'bandwidth';
  message: string;
}
const recent: Alert[] = [];
let last: { at?: string; streams: number; transcodes: number; mbps: number; error?: string } = { streams: 0, transcodes: 0, mbps: 0 };

const messaged = new Set<string>();
const over = { transcodes: false, bandwidth: false };

/** Mbit/s a stream sends: the transcode bitrate, else the source's. */
const mbps = (s: NowPlaying) => ((s.transcode?.bitrate ?? s.item.bitrate ?? 0) as number) / 1_000_000;
const label = (s: NowPlaying) => `${s.user.name} · ${s.item.seriesName ? `${s.item.seriesName} – ${s.item.title}` : s.item.title} on ${s.device ?? s.client ?? 'a device'}`;

function alert(kind: Alert['kind'], title: string, message: string) {
  recent.unshift({ at: new Date().toISOString(), kind, message: `${title}: ${message}` });
  recent.splice(20);
  emit('playback_alert', { title, message, url: '/now-playing' });
}

async function check() {
  if (!settings.enabled) return;
  let streams: NowPlaying[] | undefined;
  try {
    streams = await mainNowPlaying();
  } catch (err) {
    last = { ...last, error: (err as Error).message };
    return;
  }
  if (!streams) {
    last = { ...last, error: 'Needs a Jellyfin API key (Settings → Jellyfin)' };
    return;
  }
  const playing = streams.filter((s) => !s.state.isPaused);
  const transcoding = playing.filter((s) => s.state.playMethod === 'Transcode' && !s.transcode?.isVideoDirect);
  const total = playing.reduce((n, s) => n + mbps(s), 0);
  last = { at: new Date().toISOString(), streams: playing.length, transcodes: transcoding.length, mbps: Math.round(total * 10) / 10 };

  // Limits alert once when crossed, and re-arm when back under.
  if (settings.maxTranscodes > 0) {
    const isOver = transcoding.length > settings.maxTranscodes;
    if (isOver && !over.transcodes) {
      alert('transcodes', `${transcoding.length} streams are transcoding`, `Your limit is ${settings.maxTranscodes}. ${transcoding.map(label).join('; ')}`);
    }
    over.transcodes = isOver;
  }
  if (settings.maxMbps > 0) {
    const isOver = total > settings.maxMbps;
    if (isOver && !over.bandwidth) alert('bandwidth', `Streaming at ${Math.round(total)} Mbit/s`, `Over your ${settings.maxMbps} Mbit/s limit across ${playing.length} streams.`);
    over.bandwidth = isOver;
  }
  if (settings.fourK !== 'off') {
    for (const s of transcoding.filter((x) => x.item.resolution === '4K')) {
      const key = `${s.sessionId}:${s.item.id}`;
      if (messaged.has(key)) continue;
      messaged.add(key);
      alert('4k', '4K is being transcoded', `${label(s)} (${s.transcode?.reasons.join(', ') || 'client can’t play it directly'})`);
      // Plex can't show a message, so it only gets the alert.
      if (settings.fourK === 'message' && !plexMode()) await controlMainSession(s.sessionId, 'message', settings.message).catch(() => undefined);
    }
    const live = new Set(streams.map((s) => `${s.sessionId}:${s.item.id}`));
    for (const k of messaged) if (!live.has(k)) messaged.delete(k);
  }
}

export function guardStatus() {
  return { settings, last, recent };
}

export function startPlaybackGuard() {
  setInterval(() => void check().catch(() => undefined), 30_000).unref();
}

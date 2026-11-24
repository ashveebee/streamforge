import type { StreamPoint, Tick } from '../server/services/diagnosis/analyse.js';

/*
 * Made-up timeline for the buffering diagnosis in demo mode: three evenings
 * of streams, each buffering for a different reason.
 *
 *   1. A remote 4K movie converted on the CPU while two others also convert.
 *   2. A remote viewer while the torrent client seeds and fills the upload.
 *   3. A viewer at home on Wi-Fi while the server sits idle.
 */

const STEP = 15_000;
const MIN = 60_000;

interface Play {
  id: string;
  item: string;
  user: string;
  title: string;
  device: string;
  client: string;
  remote: boolean;
  method: StreamPoint['method'];
  start: number;
  minutes: number;
  runtime: number;
  src: number;
  out?: number;
  vfps: number;
  hw?: string;
  reasons?: string[];
  res: string;
  codec: string;
  /** Minutes into the play where it stalls, and for how long. */
  stallAt?: number;
  stallFor?: number;
  /** Transcode speed while stalling, as a share of real time. */
  slowTo?: number;
}

/** Deterministic wobble, so the demo looks the same on every run. */
const wobble = (t: number, seed: number) => Math.sin(t / 37_000 + seed) * 0.5 + Math.sin(t / 11_000 + seed * 3) * 0.5;

export function demoTicks(now = Date.now()): Tick[] {
  const minute = Math.floor(now / MIN) * MIN;
  const plays: Play[] = [
    {
      id: 'demo-a', item: 'ember-protocol', user: 'Jordan', title: 'The Ember Protocol', device: 'Jordan’s iPad', client: 'Jellyfin iOS',
      remote: true, method: 'Transcode', start: minute - 2 * 60 * MIN, minutes: 40, runtime: 128 * MIN,
      src: 64e6, out: 12e6, vfps: 23.976, reasons: ['VideoCodecNotSupported', 'ContainerBitrateExceedsLimit'], res: '4K', codec: 'hevc',
      stallAt: 22, stallFor: 2.5, slowTo: 0.68,
    },
    {
      id: 'demo-a2', item: 'quiet-harbour-s2e4', user: 'Alex', title: 'Quiet Harbour · The Lantern', device: 'Living Room TV', client: 'Jellyfin Android TV',
      remote: false, method: 'Transcode', start: minute - 2 * 60 * MIN - 10 * MIN, minutes: 55, runtime: 52 * MIN,
      src: 9e6, out: 8e6, vfps: 25, reasons: ['SubtitleCodecNotSupported'], res: '1080p', codec: 'h264',
    },
    {
      id: 'demo-a3', item: 'northbound', user: 'Casey', title: 'Northbound', device: 'Firefox', client: 'Jellyfin Web',
      remote: true, method: 'Transcode', start: minute - 2 * 60 * MIN + 5 * MIN, minutes: 30, runtime: 101 * MIN,
      src: 22e6, out: 6e6, vfps: 23.976, reasons: ['AudioCodecNotSupported', 'VideoBitDepthNotSupported'], res: '1080p', codec: 'hevc',
    },
    {
      id: 'demo-b', item: 'paper-moons-s1e6', user: 'Priya', title: 'Paper Moons · Low Tide', device: 'Pixel 9', client: 'Jellyfin Android',
      remote: true, method: 'DirectPlay', start: minute - 22 * 60 * MIN, minutes: 45, runtime: 47 * MIN,
      src: 18e6, vfps: 23.976, res: '1080p', codec: 'h264', stallAt: 18, stallFor: 3,
    },
    {
      id: 'demo-c', item: 'glass-orchard', user: 'Sam', title: 'The Glass Orchard', device: 'Bedroom TV', client: 'Jellyfin Android TV',
      remote: false, method: 'DirectPlay', start: minute - 5 * 60 * MIN, minutes: 35, runtime: 114 * MIN,
      src: 38e6, vfps: 23.976, res: '4K', codec: 'hevc', stallAt: 14, stallFor: 1.5,
    },
  ];

  const from = Math.min(...plays.map((p) => p.start)) - 10 * MIN;
  const ticks: Tick[] = [];
  const pos = new Map<string, number>();
  for (let t = from; t <= now; t += STEP) {
    const streams: StreamPoint[] = [];
    for (const p of plays) {
      if (t < p.start || t > p.start + p.minutes * MIN) continue;
      const into = (t - p.start) / MIN;
      const stalling = p.stallAt !== undefined && into >= p.stallAt && into < p.stallAt + p.stallFor!;
      const prev = pos.get(p.id) ?? 12 * MIN;
      const next = stalling ? prev + STEP * 0.15 : prev + STEP;
      pos.set(p.id, next);
      const speed = p.method === 'Transcode' ? (stalling && p.slowTo ? p.slowTo : 1.6 + wobble(t, 2) * 0.2) : undefined;
      // Converted-ahead buffer: shrinks to almost nothing while too slow.
      const ahead = speed === undefined ? undefined : stalling && p.slowTo ? 4_000 : 90_000;
      streams.push({
        id: p.id, item: p.item, user: p.user, title: p.title, device: p.device, client: p.client, remote: p.remote,
        method: p.method, paused: false, pos: Math.round(next), runtime: p.runtime, src: p.src, out: p.out,
        fps: speed !== undefined ? Math.round(p.vfps * speed * 10) / 10 : undefined, vfps: p.vfps,
        done: ahead !== undefined ? Math.min(100, ((next + ahead) / p.runtime) * 100) : undefined,
        hw: p.hw, reasons: p.reasons, res: p.res, codec: p.codec,
      });
    }

    const transcodes = streams.filter((s) => s.method === 'Transcode').length;
    // Evening 2: the torrent client seeds hard around Priya's stall.
    const b = plays[3]!;
    const seedingHard = t >= b.start + (b.stallAt! - 2) * MIN && t < b.start + (b.stallAt! + b.stallFor! + 1) * MIN;
    const up = (seedingHard ? 34e6 : 4e6) * (1 + wobble(t, 5) * 0.1);
    const down = (seedingHard ? 60e6 : 15e6) * (1 + wobble(t, 7) * 0.2);
    const sent = streams.reduce((n, s) => n + (s.method === 'Transcode' ? (s.out ?? 0) : (s.src ?? 0)), 0);
    const stallingA = streams.some((s) => s.id === 'demo-a' && s.fps !== undefined && s.fps < s.vfps! * 0.9);
    ticks.push({
      t,
      streams,
      cpu: Math.min(100, Math.round((6 + transcodes * 31 + (stallingA ? 6 : 0) + wobble(t, 1) * 3) * 10) / 10),
      rx: Math.round(down * 1.02 + 1e6),
      tx: Math.round(sent + up + 1.5e6),
      down: Math.round(down),
      up: Math.round(up),
      jf: { ok: true, ms: Math.round(140 + wobble(t, 3) * 40 + (stallingA ? 300 : 0)) },
    });
  }
  return ticks;
}

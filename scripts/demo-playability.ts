import { buildProfiles, type FeatureKind, type FileFeatures, type Observation } from '../server/services/playability/profile.js';
import type { LibraryFile } from '../server/services/playability/report.js';

/*
 * Made-up plays and library for device playability in demo mode. Each device
 * has a hidden list of things it can't play; plays are simulated the way
 * Jellyfin would report them, so the profiles are learned exactly as they
 * would be on a real server.
 */

const DAY = 86_400_000;

/** Deterministic random numbers, so the demo looks the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FILES: FileFeatures[] = [
  { container: 'mkv', vcodec: 'hevc', range: 'DOVIWithHDR10', bitdepth: 10, res: '4K', acodec: 'truehd', channels: 8, subs: ['pgssub'], bitrate: 62e6 },
  { container: 'mkv', vcodec: 'hevc', range: 'HDR10', bitdepth: 10, res: '4K', acodec: 'eac3', channels: 6, subs: ['subrip'], bitrate: 24e6 },
  { container: 'mkv', vcodec: 'hevc', range: 'DOVI', bitdepth: 10, res: '4K', acodec: 'eac3', channels: 6, subs: ['subrip'], bitrate: 18e6 },
  { container: 'mkv', vcodec: 'h264', range: 'SDR', bitdepth: 8, res: '1080p', acodec: 'eac3', channels: 6, subs: ['subrip'], bitrate: 8e6 },
  { container: 'mkv', vcodec: 'h264', range: 'SDR', bitdepth: 8, res: '1080p', acodec: 'dts', channels: 6, subs: ['pgssub'], bitrate: 14e6 },
  { container: 'mp4', vcodec: 'h264', range: 'SDR', bitdepth: 8, res: '1080p', acodec: 'aac', channels: 2, subs: [], bitrate: 6e6 },
  { container: 'mkv', vcodec: 'hevc', range: 'SDR', bitdepth: 10, res: '1080p', acodec: 'ac3', channels: 6, subs: ['ass'], bitrate: 4e6 },
  { container: 'mkv', vcodec: 'av1', range: 'SDR', bitdepth: 10, res: '1080p', acodec: 'opus', channels: 2, subs: ['subrip'], bitrate: 3e6 },
];

interface Device {
  device: string;
  client: string;
  /** What it can't play, as "kind:value". */
  cant: string[];
  /** Which of FILES it gets played on it (indexes, weighted by repetition). */
  plays: number[];
}

const DEVICES: Device[] = [
  { device: 'Living Room TV', client: 'Jellyfin Android TV', cant: ['range:DOVI', 'acodec:truehd'], plays: [0, 0, 1, 1, 1, 2, 3, 3, 3, 4, 6, 6, 5] },
  { device: 'Jordan’s iPad', client: 'Jellyfin iOS', cant: ['container:mkv', 'acodec:dts', 'acodec:truehd', 'sub:pgssub', 'vcodec:av1'], plays: [3, 3, 5, 5, 5, 4, 1, 7, 6, 0] },
  { device: 'Firefox', client: 'Jellyfin Web', cant: ['vcodec:hevc', 'range:HDR10', 'range:DOVIWithHDR10', 'acodec:ac3', 'acodec:eac3', 'acodec:dts', 'acodec:truehd', 'sub:pgssub'], plays: [5, 5, 5, 3, 3, 1, 6, 7] },
  { device: 'Bedroom TV', client: 'Jellyfin Android TV', cant: ['vcodec:av1'], plays: [3, 3, 1, 1, 4, 2, 6, 5] },
  { device: 'Hotel TV', client: 'Jellyfin Web', cant: ['vcodec:hevc'], plays: [3] },
];

const REASON: Record<FeatureKind, string> = {
  container: 'ContainerNotSupported',
  vcodec: 'VideoCodecNotSupported',
  range: 'VideoRangeTypeNotSupported',
  bitdepth: 'VideoBitDepthNotSupported',
  res: 'VideoResolutionNotSupported',
  acodec: 'AudioCodecNotSupported',
  channels: 'AudioChannelsNotSupported',
  sub: 'SubtitleCodecNotSupported',
};
const VIDEO = new Set<FeatureKind>(['vcodec', 'range', 'bitdepth', 'res', 'sub']);
const AUDIO = new Set<FeatureKind>(['acodec', 'channels']);

/** Plays the way Jellyfin would report them on each device. */
export function demoObservations(now = Date.now()): Observation[] {
  const r = rng(7);
  const out: Observation[] = [];
  for (const d of DEVICES) {
    d.plays.forEach((fi, n) => {
      const f = FILES[fi]!;
      // Some plays have subtitles on.
      const sub = f.subs?.length && r() < 0.35 ? f.subs[0] : undefined;
      const media = { ...f, sub, subs: undefined };
      const blamed = (Object.keys(REASON) as FeatureKind[]).filter((k) => {
        const v = media[k as keyof typeof media];
        return v !== undefined && d.cant.includes(`${k}:${v}`);
      });
      const video = blamed.some((k) => VIDEO.has(k));
      const audio = blamed.some((k) => AUDIO.has(k));
      out.push({
        device: d.device,
        client: d.client,
        at: now - (d.plays.length - n) * 2.5 * DAY - Math.floor(r() * DAY),
        media,
        method: video || audio ? 'Transcode' : blamed.length ? 'DirectStream' : 'DirectPlay',
        videoDirect: !video,
        audioDirect: !audio,
        reasons: blamed.map((k) => REASON[k]),
      });
    });
  }
  return out;
}

export const demoProfiles = (now = Date.now()) => buildProfiles(demoObservations(now));

/** A library file per movie, and a season's worth of episodes per series. */
export function demoLibrary(titles: { title: string; kind: 'movie' | 'series'; year: number }[], slug: (s: string) => string): LibraryFile[] {
  const r = rng(11);
  const out: LibraryFile[] = [];
  titles.forEach((t, i) => {
    const base = FILES[(i * 3) % FILES.length]!;
    if (t.kind === 'movie') {
      const versions = [{ name: undefined as string | undefined, features: base }];
      // A couple of movies have a 1080p version next to the 4K one.
      if (base.res === '4K' && i % 2 === 0) {
        versions[0]!.name = '2160p';
        versions.push({ name: '1080p', features: FILES[3]! });
      }
      out.push({ id: `${slug(t.title)}-file`, titleId: slug(t.title), title: t.title, kind: 'movie', year: t.year, versions });
      return;
    }
    const episodes = 8 + Math.floor(r() * 12);
    for (let e = 0; e < episodes; e++) {
      // Later episodes sometimes come from a different release.
      const f = e > episodes / 2 && r() < 0.5 ? FILES[(i * 3 + 1) % FILES.length]! : base;
      out.push({ id: `${slug(t.title)}-e${e + 1}`, titleId: slug(t.title), title: t.title, kind: 'series', versions: [{ features: f }] });
    }
  });
  return out;
}

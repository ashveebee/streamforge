/*
 * Device playability: the pure part.
 *
 * Every play tells us something about the device it ran on. A file that
 * played directly proves the device handles its container, video and audio.
 * When Jellyfin converts, it says why ("AudioCodecNotSupported", …) and
 * whether the video and audio were passed through untouched. Collected over
 * many plays, that is a profile of what each device can and can't play,
 * learned from real use rather than from a spec sheet.
 *
 * With a profile, any file in the library can be checked: will it play
 * directly, need a light remux, convert only the audio, or convert the video
 * (the expensive one)?
 *
 * Nothing here touches the database or network, so the demo can use it too.
 */

/** What can stop a device playing a file directly. */
export type FeatureKind = 'container' | 'vcodec' | 'range' | 'bitdepth' | 'res' | 'acodec' | 'channels' | 'sub';

export const KIND_LABEL: Record<FeatureKind, string> = {
  container: 'File type',
  vcodec: 'Video format',
  range: 'HDR',
  bitdepth: 'Bit depth',
  res: 'Resolution',
  acodec: 'Audio format',
  channels: 'Audio channels',
  sub: 'Subtitles',
};

/** The parts of a file that matter for playback, normalised. */
export interface MediaFeatures {
  container?: string;
  vcodec?: string;
  range?: string;
  bitdepth?: number;
  res?: string;
  acodec?: string;
  channels?: number;
  /** Codec of the subtitle track in use (plays) or none. */
  sub?: string;
  /** Overall bitrate in bits per second. */
  bitrate?: number;
}

export type Method = 'DirectPlay' | 'DirectStream' | 'Transcode';

/** One play on one device. */
export interface Observation {
  device: string;
  client?: string;
  at: number;
  media: MediaFeatures;
  method: Method;
  videoDirect: boolean;
  audioDirect: boolean;
  reasons: string[];
}

export type Status = 'yes' | 'no';

export interface Capability {
  kind: FeatureKind;
  value: string;
  label: string;
  status: Status;
  ok: number;
  bad: number;
  lastAt: number;
}

export interface DeviceProfile {
  key: string;
  device: string;
  client?: string;
  plays: number;
  lastSeen: number;
  direct: number;
  converted: number;
  capabilities: Capability[];
  /** Plays converted because of a bitrate limit: a user or network setting, not the device. */
  bitrateLimited: number;
}

export const deviceKey = (device: string, client?: string) => `${client ?? ''}|${device}`;

/* ------------------------------ normalising ------------------------------ */

export function resBucket(width?: number, height?: number) {
  if (!width && !height) return undefined;
  const w = width ?? 0;
  const h = height ?? 0;
  if (w >= 3200 || h >= 1800) return '4K';
  if (w >= 1800 || h >= 1000) return '1080p';
  if (w >= 1200 || h >= 700) return '720p';
  return 'SD';
}

const lower = (s?: string) => (s ? s.toLowerCase() : undefined);

/** Collapses codec spellings Jellyfin uses interchangeably. */
export function normCodec(c?: string) {
  const v = lower(c);
  if (!v) return undefined;
  if (v === 'h265' || v === 'x265') return 'hevc';
  if (v === 'x264' || v === 'avc') return 'h264';
  if (v === 'dca') return 'dts';
  if (v === 'pgs' || v === 'hdmv_pgs_subtitle') return 'pgssub';
  if (v === 'srt') return 'subrip';
  if (v === 'dvd_subtitle' || v === 'vobsub') return 'dvdsub';
  return v;
}

/** Jellyfin's container lists ("mov,mp4,m4a,…") use the first name. */
export const normContainer = (c?: string) => lower(c)?.split(',')[0]?.trim() || undefined;

export function normRange(r?: string) {
  if (!r || r === 'SDR' || r === 'Unknown') return 'SDR';
  return r;
}

/* ----------------------------- describing values ----------------------------- */

const CODEC_NAMES: Record<string, string> = {
  hevc: 'HEVC (H.265)',
  h264: 'H.264',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
  mpeg4: 'MPEG-4',
  truehd: 'Dolby TrueHD',
  eac3: 'Dolby Digital Plus',
  ac3: 'Dolby Digital',
  dts: 'DTS',
  aac: 'AAC',
  flac: 'FLAC',
  opus: 'Opus',
  mp3: 'MP3',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  pgssub: 'PGS (image)',
  dvdsub: 'DVD (image)',
  dvbsub: 'DVB (image)',
  subrip: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MP4 text',
};
const RANGE_NAMES: Record<string, string> = {
  SDR: 'SDR',
  HDR10: 'HDR10',
  HDR10Plus: 'HDR10+',
  HLG: 'HLG',
  DOVI: 'Dolby Vision only',
  DOVIWithHDR10: 'Dolby Vision (with HDR10)',
  DOVIWithHLG: 'Dolby Vision (with HLG)',
  DOVIWithSDR: 'Dolby Vision (with SDR)',
};

export function valueLabel(kind: FeatureKind, value: string) {
  switch (kind) {
    case 'container':
      return value.toUpperCase();
    case 'vcodec':
    case 'acodec':
    case 'sub':
      return CODEC_NAMES[value] ?? value.toUpperCase();
    case 'range':
      return RANGE_NAMES[value] ?? value;
    case 'bitdepth':
      return `${value}-bit`;
    case 'channels': {
      const n = Number(value);
      return n === 1 ? 'Mono' : n === 2 ? 'Stereo' : n === 6 ? '5.1' : n === 8 ? '7.1' : `${n} channels`;
    }
    default:
      return value;
  }
}

/** "TrueHD audio", "Dolby Vision", "PGS subtitles": a value in a sentence. */
export function phrase(kind: FeatureKind, value: string) {
  const v = valueLabel(kind, value);
  switch (kind) {
    case 'container':
      return `${v} files`;
    case 'vcodec':
      return `${v} video`;
    case 'acodec':
      return `${v} audio`;
    case 'channels':
      return `${v} audio`;
    case 'sub':
      return `${v} subtitles`;
    case 'bitdepth':
      return `${v} video`;
    default:
      return v;
  }
}

/** True for subtitle formats that are pictures: a device that can't draw them forces the video to convert. */
export const isImageSub = (codec?: string) => !!codec && ['pgssub', 'dvdsub', 'dvbsub'].includes(codec);

/* ------------------------------- learning ------------------------------- */

const VIDEO_KINDS: FeatureKind[] = ['vcodec', 'range', 'bitdepth', 'res'];
const AUDIO_KINDS: FeatureKind[] = ['acodec', 'channels'];

/** Which feature a Jellyfin transcode reason blames. */
const REASON_KIND: Record<string, FeatureKind> = {
  ContainerNotSupported: 'container',
  VideoCodecNotSupported: 'vcodec',
  VideoProfileNotSupported: 'vcodec',
  VideoLevelNotSupported: 'vcodec',
  RefFramesNotSupported: 'vcodec',
  VideoRangeTypeNotSupported: 'range',
  VideoBitDepthNotSupported: 'bitdepth',
  VideoResolutionNotSupported: 'res',
  AudioCodecNotSupported: 'acodec',
  AudioProfileNotSupported: 'acodec',
  AudioChannelsNotSupported: 'channels',
  SubtitleCodecNotSupported: 'sub',
};
const BITRATE_REASONS = new Set(['ContainerBitrateExceedsLimit', 'VideoBitrateNotSupported', 'AudioBitrateNotSupported']);

function featureValue(m: MediaFeatures, kind: FeatureKind): string | undefined {
  const v = m[kind];
  return v === undefined || v === '' ? undefined : String(v);
}

/** What one play proves: features it played fine with, and features it blamed. */
export function evidence(o: Observation) {
  const ok: FeatureKind[] = [];
  const bad: FeatureKind[] = [];
  const blamed = new Set(o.reasons.map((r) => REASON_KIND[r]).filter((k): k is FeatureKind => !!k));
  if (o.method === 'DirectPlay') {
    ok.push('container', ...VIDEO_KINDS, ...AUDIO_KINDS);
    if (o.media.sub) ok.push('sub');
  } else {
    if (o.videoDirect) ok.push(...VIDEO_KINDS);
    if (o.audioDirect) ok.push(...AUDIO_KINDS);
    // A subtitle the device draws itself while the video passes through.
    if (o.videoDirect && o.media.sub && !blamed.has('sub')) ok.push('sub');
  }
  for (const k of blamed) bad.push(k);
  return { ok: ok.filter((k) => !blamed.has(k)), bad };
}

/** Builds a profile per device from its plays. */
export function buildProfiles(observations: Observation[]): DeviceProfile[] {
  const byDevice = new Map<string, Observation[]>();
  for (const o of observations) {
    const key = deviceKey(o.device, o.client);
    const list = byDevice.get(key) ?? [];
    list.push(o);
    byDevice.set(key, list);
  }
  const profiles: DeviceProfile[] = [];
  for (const [key, list] of byDevice) {
    list.sort((a, b) => a.at - b.at);
    const tally = new Map<string, Capability>();
    for (const o of list) {
      const { ok, bad } = evidence(o);
      const note = (kind: FeatureKind, good: boolean) => {
        const value = featureValue(o.media, kind);
        if (!value) return;
        const id = `${kind}:${value}`;
        const c = tally.get(id) ?? { kind, value, label: valueLabel(kind, value), status: good ? 'yes' : 'no', ok: 0, bad: 0, lastAt: 0 };
        if (good) c.ok++;
        else c.bad++;
        // The most recent outcome wins: apps get updated, settings change.
        c.status = good ? 'yes' : 'no';
        c.lastAt = o.at;
        tally.set(id, c);
      };
      for (const k of ok) note(k, true);
      for (const k of bad) note(k, false);
    }
    const last = list.at(-1)!;
    profiles.push({
      key,
      device: last.device,
      client: last.client,
      plays: list.length,
      lastSeen: last.at,
      direct: list.filter((o) => o.method === 'DirectPlay').length,
      converted: list.filter((o) => o.method === 'Transcode').length,
      capabilities: [...tally.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || Number(a.status === 'yes') - Number(b.status === 'yes') || b.ok + b.bad - (a.ok + a.bad)),
      bitrateLimited: list.filter((o) => o.reasons.some((r) => BITRATE_REASONS.has(r))).length,
    });
  }
  return profiles.sort((a, b) => b.plays - a.plays);
}

const KINDS: FeatureKind[] = ['container', 'vcodec', 'range', 'bitdepth', 'res', 'acodec', 'channels', 'sub'];

/* ------------------------------- predicting ------------------------------- */

/**
 * How a file would play, cheapest first: directly, remuxed into another
 * file type, with the audio converted, or with the video converted.
 */
export type Verdict = 'direct' | 'remux' | 'audio' | 'video';

export interface Prediction {
  verdict: Verdict;
  /** What forces the conversion. */
  problems: { kind: FeatureKind; value: string; text: string }[];
  /** Parts of the file this device has never played. */
  untested: { kind: FeatureKind; value: string; text: string }[];
  /** Image subtitles this device can't draw: turning them on converts the video. */
  subtitleWarning?: string;
}

/** A file's features, plus the subtitle formats it carries (any could be turned on). */
export interface FileFeatures extends MediaFeatures {
  subs?: string[];
}

export function predict(profile: DeviceProfile, file: FileFeatures): Prediction {
  const caps = new Map(profile.capabilities.map((c) => [`${c.kind}:${c.value}`, c]));
  const problems: Prediction['problems'] = [];
  const untested: Prediction['untested'] = [];
  for (const kind of KINDS) {
    if (kind === 'sub') continue;
    const value = featureValue(file, kind);
    if (!value) continue;
    const c = caps.get(`${kind}:${value}`);
    const item = { kind, value, text: phrase(kind, value) };
    if (!c) untested.push(item);
    else if (c.status === 'no') problems.push(item);
  }
  const kinds = new Set(problems.map((p) => p.kind));
  const verdict: Verdict = VIDEO_KINDS.some((k) => kinds.has(k))
    ? 'video'
    : AUDIO_KINDS.some((k) => kinds.has(k))
      ? 'audio'
      : kinds.has('container')
        ? 'remux'
        : 'direct';
  const badSub = (file.subs ?? []).find((s) => isImageSub(s) && caps.get(`sub:${s}`)?.status === 'no');
  return {
    verdict,
    problems,
    untested: untested.filter(
      (u) =>
        // An SDR file needs no HDR support, so "untested SDR" is noise.
        !(u.kind === 'range' && u.value === 'SDR') &&
        !(u.kind === 'bitdepth' && u.value === '8') &&
        // A part that converts anyway doesn't need testing.
        !(VIDEO_KINDS.includes(u.kind) && verdict === 'video') &&
        !(AUDIO_KINDS.includes(u.kind) && problems.some((p) => AUDIO_KINDS.includes(p.kind))),
    ),
    subtitleWarning: badSub ? `${phrase('sub', badSub)} would convert the video if turned on` : undefined,
  };
}

/** Devices worth checking against: played on recently and more than once. */
export function householdDevices(profiles: DeviceProfile[], now = Date.now()) {
  return profiles.filter((p) => p.plays >= 3 && now - p.lastSeen < 90 * 86_400_000);
}

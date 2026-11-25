/*
 * Buffering diagnosis: the pure part.
 *
 * Given a timeline of samples (streams, host CPU and network, download
 * client speeds, Jellyfin's responsiveness), this finds moments where a
 * stream stopped moving forward and works out the most likely cause.
 *
 * Nothing here touches the database or the network, so the demo server can
 * run the same logic over made-up samples.
 */

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

/** One stream as seen in one sample. Bitrates are bits per second. */
export interface StreamPoint {
  /** Jellyfin session id. */
  id: string;
  item: string;
  user: string;
  title: string;
  device?: string;
  client?: string;
  /** Watching from outside the local network. */
  remote: boolean;
  method: PlayMethod;
  paused: boolean;
  /** Playback position and runtime in ms. */
  pos: number;
  runtime: number;
  /** Source video bitrate. */
  src?: number;
  /** Bitrate Jellyfin sends when converting. */
  out?: number;
  /** Frames per second Jellyfin is converting at, and the video's own rate. */
  fps?: number;
  vfps?: number;
  /** How much of the file Jellyfin has converted so far, in percent. */
  done?: number;
  hw?: string;
  reasons?: string[];
  res?: string;
  codec?: string;
}

/** Everything recorded at one moment. Network figures are bits per second. */
export interface Tick {
  t: number;
  streams: StreamPoint[];
  /** Host CPU use in percent. */
  cpu?: number;
  /** Host network received / sent. */
  rx?: number;
  tx?: number;
  /** Download clients' combined download / upload speed. */
  down?: number;
  up?: number;
  /** Jellyfin's last health check. */
  jf?: { ok: boolean; ms?: number };
}

export interface Incident {
  id: string;
  session: string;
  item: string;
  user: string;
  title: string;
  device?: string;
  client?: string;
  remote: boolean;
  method: PlayMethod;
  start: number;
  end: number;
  /** Playback time lost: how far behind real time the stream fell. */
  lostMs: number;
}

export interface Finding {
  id: 'transcode' | 'cpu' | 'upload' | 'bitrate' | 'downloads' | 'jellyfin' | 'client';
  title: string;
  detail: string;
  /** 0–1; null for the "nothing on the server" fallback. */
  confidence: number | null;
  evidence: string[];
  fixes: string[];
}

export interface Analysis {
  from: number;
  to: number;
  focus: { from: number; to: number };
  stream?: {
    id: string;
    user: string;
    title: string;
    device?: string;
    client?: string;
    remote: boolean;
    method: PlayMethod;
    res?: string;
    codec?: string;
    bitrate?: number;
    hw?: string;
    reasons: string[];
  };
  findings: Finding[];
  /** Stalled stretches of the analysed stream inside [from, to]. */
  stalls: { start: number; end: number }[];
  others: { user: string; title: string; method: PlayMethod; remote: boolean; bitrate?: number }[];
  series: {
    t: number;
    cpu?: number;
    tx?: number;
    rx?: number;
    down?: number;
    up?: number;
    bitrate?: number;
    speed?: number;
    streams: number;
    transcodes: number;
    jfMs?: number;
  }[];
  /** What the upload figures were measured against. */
  upload?: { capacity: number; estimated: boolean };
  hasHost: boolean;
  hasClients: boolean;
}

/* ------------------------------- detection ------------------------------- */

/** A stall interval is flagged when playback moved less than this share of real time. */
const SLOW_SHARE = 0.6;
/** And an incident is kept only when this much playback time was lost overall. */
const MIN_LOST_MS = 15_000;
/** Stalled intervals closer than this are one incident. */
const MERGE_GAP_MS = 60_000;
/** Ignore the first moments of a play: start-up buffering is normal. */
const STARTUP_MS = 30_000;

interface Interval {
  start: number;
  end: number;
  lost: number;
}

/** Stalled intervals per session, from consecutive samples. */
function stalledIntervals(ticks: Tick[]) {
  const out = new Map<string, { point: StreamPoint; intervals: Interval[] }>();
  const prev = new Map<string, { t: number; p: StreamPoint; first: number }>();
  for (const tick of ticks) {
    const seen = new Set<string>();
    for (const p of tick.streams) {
      seen.add(p.id);
      const last = prev.get(p.id);
      const first = last && last.p.item === p.item ? last.first : tick.t;
      prev.set(p.id, { t: tick.t, p, first });
      if (!last || last.p.item !== p.item) continue;
      const dt = tick.t - last.t;
      // Long gaps mean StreamForge wasn't sampling; can't say anything.
      if (dt < 5_000 || dt > 90_000) continue;
      if (p.paused || last.p.paused) continue;
      if (last.t - first < STARTUP_MS) continue;
      const advance = p.pos - last.p.pos;
      // A jump back (or far forward) is a seek, not a stall.
      if (advance < -5_000 || advance > dt * 3) continue;
      const transcodeBehind =
        p.method === 'Transcode' &&
        p.fps !== undefined &&
        p.vfps !== undefined &&
        p.fps < p.vfps * 0.95 &&
        aheadMs(p) !== undefined &&
        aheadMs(p)! < 10_000;
      if (advance >= dt * SLOW_SHARE && !transcodeBehind) continue;
      const entry = out.get(p.id) ?? { point: p, intervals: [] };
      entry.point = p;
      entry.intervals.push({ start: last.t, end: tick.t, lost: Math.max(0, dt - Math.max(0, advance)) });
      out.set(p.id, entry);
    }
    for (const id of prev.keys()) if (!seen.has(id)) prev.delete(id);
  }
  return out;
}

function merge(intervals: Interval[]) {
  const merged: Interval[] = [];
  for (const i of intervals) {
    const last = merged.at(-1);
    if (last && i.start - last.end <= MERGE_GAP_MS) {
      last.end = Math.max(last.end, i.end);
      last.lost += i.lost;
    } else merged.push({ ...i });
  }
  return merged;
}

/** Moments where a stream fell behind real time, newest first. */
export function findIncidents(ticks: Tick[]): Incident[] {
  const incidents: Incident[] = [];
  for (const [session, { point, intervals }] of stalledIntervals(ticks)) {
    for (const m of merge(intervals)) {
      if (m.lost < MIN_LOST_MS) continue;
      incidents.push({
        id: `${session}:${m.start}`,
        session,
        item: point.item,
        user: point.user,
        title: point.title,
        device: point.device,
        client: point.client,
        remote: point.remote,
        method: point.method,
        start: m.start,
        end: m.end,
        lostMs: Math.round(m.lost),
      });
    }
  }
  return incidents.sort((a, b) => b.start - a.start);
}

/* -------------------------------- analysis ------------------------------- */

const avg = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
const max = (xs: (number | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.max(...v) : undefined;
};
const median = (xs: number[]) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const mbps = (bps: number) => (bps >= 10e6 ? `${Math.round(bps / 1e6)} Mbps` : `${(bps / 1e6).toFixed(1)} Mbps`);
const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.max(0, Math.round(ms / 1000))} s`);

/** How far ahead of the viewer Jellyfin has converted, when known. */
function aheadMs(p: StreamPoint) {
  if (p.done === undefined || !p.runtime) return undefined;
  return (p.done / 100) * p.runtime - p.pos;
}

const bitrateOf = (p: StreamPoint) => (p.method === 'Transcode' ? (p.out ?? p.src) : p.src);

/** Jellyfin's transcode reasons in plain words. */
const REASONS: Record<string, string> = {
  ContainerNotSupported: 'the device can’t open this file type',
  VideoCodecNotSupported: 'the device can’t play this video format',
  AudioCodecNotSupported: 'the device can’t play this audio format',
  SubtitleCodecNotSupported: 'the subtitles have to be burned into the picture',
  AudioIsExternal: 'the audio track is a separate file',
  SecondaryAudioNotSupported: 'the device can’t switch audio tracks itself',
  VideoProfileNotSupported: 'the device can’t play this video profile',
  VideoLevelNotSupported: 'the device can’t play this video level',
  VideoResolutionNotSupported: 'the resolution is too high for the device',
  VideoBitDepthNotSupported: 'the device can’t play 10-bit video',
  VideoFramerateNotSupported: 'the device can’t play this frame rate',
  RefFramesNotSupported: 'the device can’t play this encoding',
  AnamorphicVideoNotSupported: 'the device can’t play anamorphic video',
  InterlacedVideoNotSupported: 'the video is interlaced',
  AudioChannelsNotSupported: 'the device can’t play this many audio channels',
  AudioProfileNotSupported: 'the device can’t play this audio profile',
  AudioSampleRateNotSupported: 'the device can’t play this audio sample rate',
  AudioBitDepthNotSupported: 'the device can’t play this audio bit depth',
  ContainerBitrateExceedsLimit: 'the file is above the bitrate limit set for this device or user',
  VideoBitrateNotSupported: 'the video bitrate is above what the device accepts',
  AudioBitrateNotSupported: 'the audio bitrate is above what the device accepts',
  UnknownVideoStreamInfo: 'Jellyfin couldn’t read the video details',
  UnknownAudioStreamInfo: 'Jellyfin couldn’t read the audio details',
  DirectPlayError: 'direct play failed on the device',
  VideoRangeTypeNotSupported: 'the device can’t display this HDR format',
};
export const reasonText = (r: string) => REASONS[r] ?? r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

export interface AnalyseOptions {
  /** Internet upload speed in bits per second, when the admin set it. */
  uploadBps?: number;
  /** Every tick on record, for estimating upload capacity and normal Jellyfin latency. */
  history?: Tick[];
}

/**
 * Explains a moment. `focus` is the stretch to explain (an incident, or a
 * moment someone reported); `session` narrows it to one stream.
 */
export function analyse(ticks: Tick[], focus: { from: number; to: number; session?: string }, opts: AnalyseOptions = {}): Analysis {
  const from = focus.from - 5 * 60_000;
  const to = focus.to + 2 * 60_000;
  const window = ticks.filter((t) => t.t >= from && t.t <= to);
  // A little lead-in: problems usually start just before the picture freezes.
  const inFocus = window.filter((t) => t.t >= focus.from - 30_000 && t.t <= focus.to);
  const near = inFocus.length ? inFocus : window.filter((t) => Math.abs(t.t - focus.from) <= 60_000);
  const history = opts.history ?? ticks;

  const points = focus.session ? near.flatMap((t) => t.streams.filter((s) => s.id === focus.session)) : [];
  const last = points.at(-1) ?? (focus.session ? window.flatMap((t) => t.streams.filter((s) => s.id === focus.session)).at(-1) : undefined);
  const hasHost = near.some((t) => t.cpu !== undefined);
  const hasClients = near.some((t) => t.down !== undefined);

  const findings: Finding[] = [];

  /* --- Jellyfin couldn't convert fast enough --- */
  const transcoding = points.filter((p) => p.method === 'Transcode');
  if (last && transcoding.length) {
    const ratios = transcoding.filter((p) => p.fps && p.vfps).map((p) => p.fps! / p.vfps!);
    const ratio = avg(ratios);
    const ahead = transcoding.map(aheadMs).filter((x): x is number => x !== undefined);
    const minAhead = ahead.length ? Math.min(...ahead) : undefined;
    const otherTranscodes = max(near.map((t) => t.streams.filter((s) => s.id !== focus.session && s.method === 'Transcode' && !s.paused).length)) ?? 0;
    const slow = ratio !== undefined && ratio < 0.95;
    const starved = minAhead !== undefined && minAhead < 15_000;
    if (slow || (starved && ratio === undefined)) {
      const p = transcoding.at(-1)!;
      const evidence: string[] = [];
      if (ratio !== undefined) {
        const fps = avg(transcoding.map((x) => x.fps))!;
        evidence.push(`Converting at ${Math.round(fps)} fps for a ${Math.round(p.vfps!)} fps video (${ratio.toFixed(2)}× real time)`);
      }
      if (minAhead !== undefined) evidence.push(`Only ${secs(minAhead)} converted ahead of the viewer`);
      const reasons = [...new Set(transcoding.flatMap((x) => x.reasons ?? []))];
      if (reasons.length) evidence.push(`Converting because ${reasons.slice(0, 3).map(reasonText).join('; ')}`);
      evidence.push(p.hw ? `Hardware acceleration: ${p.hw}` : 'No hardware acceleration: the CPU does all the work');
      if (otherTranscodes) evidence.push(`${otherTranscodes} other stream${otherTranscodes === 1 ? ' was' : 's were'} converting at the same time`);
      const fixes: string[] = [];
      if (!p.hw) fixes.push('Turn on hardware acceleration in Jellyfin (Dashboard → Playback → Transcoding)');
      if (reasons.some((r) => r.startsWith('Subtitle'))) fixes.push('Pick a text subtitle (SRT) or turn subtitles off: image subtitles force the picture to be converted');
      if (reasons.some((r) => /Codec|Profile|Level|BitDepth|RangeType/.test(r))) fixes.push('Get a version this device can play directly (often H.264 or SDR)');
      if (reasons.includes('ContainerBitrateExceedsLimit')) fixes.push('Raise the bitrate limit for this user or device, if the connection allows');
      if (otherTranscodes) fixes.push('Limit how many streams can convert at once');
      findings.push({
        id: 'transcode',
        title: 'Jellyfin couldn’t convert the video fast enough',
        detail:
          'This stream was being converted (transcoded) for the device, and Jellyfin was producing video slower than it was being watched, so the player ran out.',
        confidence: slow && starved ? 0.92 : slow ? (ratio! < 0.8 ? 0.85 : 0.7) : 0.6,
        evidence,
        fixes,
      });
    }
  }

  /* --- The CPU was maxed out --- */
  const cpu = avg(near.map((t) => t.cpu));
  if (cpu !== undefined && cpu >= 85) {
    const transcodes = max(near.map((t) => t.streams.filter((s) => s.method === 'Transcode' && !s.paused).length)) ?? 0;
    findings.push({
      id: 'cpu',
      title: `The server’s CPU was maxed out (${Math.round(cpu)}%)`,
      detail: transcodes
        ? 'Converting video is heavy work. With the CPU this busy, Jellyfin can fall behind.'
        : 'Something on the server was using almost all of the CPU, which slows Jellyfin down.',
      confidence: transcodes ? (cpu >= 95 ? 0.8 : 0.65) : 0.5,
      evidence: [
        `Average CPU use around the stall: ${Math.round(cpu)}%`,
        transcodes ? `${transcodes} stream${transcodes === 1 ? '' : 's'} being converted` : 'No streams were being converted, so something else was busy',
        'Measured on the machine running StreamForge; if Jellyfin runs elsewhere this may not be Jellyfin’s CPU',
      ],
      fixes: transcodes
        ? ['Turn on hardware acceleration in Jellyfin', 'Limit how many streams can convert at once']
        : ['Check what else runs on the server at this time (scheduled tasks, unpacking downloads, backups)'],
    });
  }

  /* --- Upload full (remote viewers) --- */
  let upload: Analysis['upload'];
  {
    const peak = max(history.map(internetUp));
    const capacity = opts.uploadBps ?? (peak && peak > 5e6 ? peak : undefined);
    if (capacity) upload = { capacity, estimated: !opts.uploadBps };
    const used = avg(near.map(internetUp));
    const streamsOut = avg(near.map((t) => streamTotal(t, true))) ?? 0;
    const seeding = avg(near.map((t) => t.up));
    const anyRemote = last ? last.remote : near.some((t) => t.streams.some((s) => s.remote && !s.paused));
    if (capacity && used !== undefined && anyRemote && used >= capacity * 0.85) {
      const evidence = [`Upload in use: ${mbps(used)} of ${upload!.estimated ? 'about ' : ''}${mbps(capacity)}${upload!.estimated ? ' (the most StreamForge has seen)' : ''}`];
      if (seeding && seeding > 1e6) evidence.push(`Download clients uploading (seeding): ${mbps(seeding)}`);
      const remoteStreams = max(near.map((t) => t.streams.filter((s) => s.remote && !s.paused).length)) ?? 0;
      if (streamsOut) evidence.push(`Streams: ${mbps(streamsOut)} across ${remoteStreams} remote viewer${remoteStreams === 1 ? '' : 's'}`);
      const fixes: string[] = [];
      if (seeding && seeding > 0.2 * used) fixes.push('Cap the download clients’ upload speed while people are watching (Downloads → speed limits)');
      fixes.push('Set a remote streaming bitrate limit in Jellyfin (Dashboard → Playback → Streaming)');
      findings.push({
        id: 'upload',
        title: 'Your internet upload was full',
        detail: 'Viewers outside your home get video through your internet upload. It was nearly all in use, so there wasn’t room to send this stream smoothly.',
        confidence: (seeding && seeding > 0.2 * used ? 0.85 : 0.75) - (upload!.estimated ? 0.1 : 0),
        evidence,
        fixes,
      });
    }
  }

  /* --- The video needs a lot of bandwidth --- */
  if (last) {
    const b = bitrateOf(last);
    if (b) {
      const tooMuch = last.remote ? (upload && !upload.estimated ? b > upload.capacity * 0.6 : b > 25e6) : b > 80e6;
      if (tooMuch) {
        findings.push({
          id: 'bitrate',
          title: `The video needs ${mbps(b)}`,
          detail: last.remote
            ? 'That is more than many home internet connections can carry steadily to a viewer outside your home.'
            : 'That is a lot for Wi-Fi. Even on your own network, a weak signal or a busy network can’t keep up.',
          confidence: last.remote ? 0.55 : 0.45,
          evidence: [
            `${[last.res, last.codec?.toUpperCase()].filter(Boolean).join(' ')} ${last.method === 'Transcode' ? 'converted to' : 'at'} ${mbps(b)}`.trim(),
            last.remote ? 'The viewer is outside your network' : 'The viewer is on your own network',
          ],
          fixes: last.remote
            ? ['Set a remote streaming bitrate limit in Jellyfin', 'Ask the viewer to lower the quality in their player']
            : ['Use a wired connection for this device, or move it closer to the router', 'Lower the quality in the player'],
        });
      }
    }
  }

  /* --- Downloads busy --- */
  const down = avg(near.map((t) => t.down));
  if (down !== undefined && down >= 160e6) {
    findings.push({
      id: 'downloads',
      title: `Downloads were running flat out (${mbps(down)})`,
      detail: 'Heavy downloading and unpacking compete with Jellyfin for disk reads and your connection.',
      confidence: last && last.method !== 'Transcode' && !last.remote ? 0.5 : 0.35,
      evidence: [`Download clients: ${mbps(down)} down`, ...(last?.remote ? [] : ['A busy disk shows up first on high-bitrate files played directly'])],
      fixes: ['Add a rule that slows downloads while someone is watching', 'Keep downloads on a different disk from your library'],
    });
  }

  /* --- Jellyfin itself slow or down --- */
  {
    const jf = near.map((t) => t.jf).filter((x): x is NonNullable<Tick['jf']> => !!x);
    const normal = median(history.flatMap((t) => (t.jf?.ok && t.jf.ms !== undefined ? [t.jf.ms] : [])));
    const worst = max(jf.map((j) => j.ms));
    if (jf.some((j) => !j.ok)) {
      findings.push({
        id: 'jellyfin',
        title: 'Jellyfin stopped responding',
        detail: 'StreamForge’s health check couldn’t reach Jellyfin at this time, so the player couldn’t either.',
        confidence: 0.75,
        evidence: [`${jf.filter((j) => !j.ok).length} of ${jf.length} health checks failed`],
        fixes: ['Check Jellyfin’s logs for this time (Dashboard → Logs)', 'Look for a library scan or scheduled task running then'],
      });
    } else if (worst !== undefined && worst > Math.max(1_000, (normal ?? 250) * 4)) {
      findings.push({
        id: 'jellyfin',
        title: `Jellyfin was slow to respond (${(worst / 1000).toFixed(1)} s)`,
        detail: 'Jellyfin took much longer than usual to answer, which usually means it, or its disk, was busy.',
        confidence: 0.5,
        evidence: [`Slowest health check: ${(worst / 1000).toFixed(1)} s`, ...(normal ? [`Usually: ${Math.round(normal)} ms`] : [])],
        fixes: ['Check for a library scan or scheduled task at this time', 'Check the disk holding Jellyfin’s data and transcode folder'],
      });
    }
  }

  findings.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  /* --- Nothing on the server --- */
  if (!findings.some((f) => (f.confidence ?? 0) >= 0.45)) {
    const evidence: string[] = [];
    if (last) evidence.push(last.method === 'Transcode' ? 'Jellyfin was converting this stream and keeping up' : `Played without converting (${last.method === 'DirectPlay' ? 'direct play' : 'direct stream'})`);
    if (cpu !== undefined) evidence.push(`Server CPU: ${Math.round(cpu)}%`);
    const used = avg(near.map(internetUp));
    if (used !== undefined && upload) evidence.push(`Upload in use: ${mbps(used)} of ${upload.estimated ? 'about ' : ''}${mbps(upload.capacity)}`);
    if (down !== undefined) evidence.push(`Downloads: ${mbps(down)}`);
    if (!hasHost && !hasClients) evidence.push('Turn on host metrics and connect your download clients for a more complete picture');
    findings.push({
      id: 'client',
      title: 'Nothing on the server stood out',
      detail: last?.remote
        ? 'The server was keeping up. The likely cause is between your server and the viewer: their internet connection or Wi-Fi.'
        : 'The server was keeping up. The likely cause is between the server and the device: usually Wi-Fi, or the device itself struggling.',
      confidence: null,
      evidence,
      fixes: last?.remote
        ? ['Ask the viewer to lower the quality in their player', 'Set a remote streaming bitrate limit in Jellyfin']
        : ['Try the device on a wired connection', 'Lower the quality in the player to see if it stops'],
    });
  }

  const stalls = focus.session
    ? merge(stalledIntervals(window).get(focus.session)?.intervals ?? []).map(({ start, end }) => ({ start, end }))
    : [];

  const others = new Map<string, Analysis['others'][number]>();
  for (const t of near) for (const s of t.streams) if (s.id !== focus.session && !s.paused) others.set(s.id, { user: s.user, title: s.title, method: s.method, remote: s.remote, bitrate: bitrateOf(s) });

  return {
    from,
    to,
    focus: { from: focus.from, to: focus.to },
    stream: last && {
      id: last.id,
      user: last.user,
      title: last.title,
      device: last.device,
      client: last.client,
      remote: last.remote,
      method: last.method,
      res: last.res,
      codec: last.codec,
      bitrate: bitrateOf(last),
      hw: last.hw,
      reasons: [...new Set(points.flatMap((p) => p.reasons ?? []))].map(reasonText),
    },
    findings,
    stalls,
    others: [...others.values()],
    series: window.map((t) => {
      const p = focus.session ? t.streams.find((s) => s.id === focus.session) : undefined;
      return {
        t: t.t,
        cpu: t.cpu,
        tx: t.tx,
        rx: t.rx,
        down: t.down,
        up: t.up,
        bitrate: p && bitrateOf(p),
        speed: p?.method === 'Transcode' && p.fps && p.vfps ? p.fps / p.vfps : undefined,
        streams: t.streams.filter((s) => !s.paused).length,
        transcodes: t.streams.filter((s) => !s.paused && s.method === 'Transcode').length,
        jfMs: t.jf?.ok ? t.jf.ms : undefined,
      };
    }),
    upload,
    hasHost,
    hasClients,
  };
}

/** Bits per second playing streams were sending at one moment (remote or local ones). */
function streamTotal(t: Tick, remote: boolean) {
  return t.streams.reduce((n, s) => n + (s.paused || s.remote !== remote ? 0 : (bitrateOf(s) ?? 0)), 0);
}

/**
 * What was going out over the internet: the host's outgoing traffic minus
 * streams to the local network, or without host metrics, seeding plus
 * remote streams.
 */
function internetUp(t: Tick) {
  if (t.tx !== undefined) return Math.max(0, t.tx - streamTotal(t, false));
  return t.up !== undefined ? t.up + streamTotal(t, true) : undefined;
}

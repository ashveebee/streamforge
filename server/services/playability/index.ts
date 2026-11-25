import { db } from '../../lib/db.js';
import { cache } from '../../lib/cache.js';
import { resolve } from '../../settings.js';
import * as jellyfin from '../jellyfin.js';
import { buildProfiles, deviceKey, householdDevices, normCodec, normContainer, normRange, resBucket, type DeviceProfile, type FileFeatures, type Method, type Observation } from './profile.js';
import { libraryReport, statusOf, titleReport, type LibraryFile } from './report.js';

/*
 * Device playability: recording plays and checking the library.
 *
 * The buffering recorder already asks Jellyfin for every stream every 15
 * seconds; it hands each sample here. One row per play keeps the file's
 * formats, the tracks in use and how Jellyfin delivered it, merged over the
 * play (a play that ever converted counts as converted, with every reason
 * Jellyfin gave). Plays are kept for a year.
 */

const KEEP_MS = 365 * 86_400_000;

type Stream = NonNullable<Awaited<ReturnType<typeof jellyfin.serverNowPlaying>>>[number];

const RANK: Record<Method, number> = { DirectPlay: 0, DirectStream: 1, Transcode: 2 };
const active = new Map<string, { id: string; obs: Observation; title: string; itemId: string; json: string }>();
const upsert = db.prepare(
  `INSERT INTO device_plays (id, device_key, item_id, title, at, data) VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
);

function featuresOf(s: Stream): FileFeatures {
  const m = s.media;
  return {
    container: normContainer(m.container),
    vcodec: normCodec(m.video?.codec),
    range: m.video ? normRange(m.video.range) : undefined,
    bitdepth: m.video?.bitDepth,
    res: resBucket(m.video?.width, m.video?.height),
    acodec: normCodec(m.audio?.codec),
    channels: m.audio?.channels,
    sub: normCodec(m.subtitle?.codec),
    bitrate: m.bitrate,
  };
}

/** Folds one sample of the active streams into the plays on record. */
export function observeStreams(streams: Stream[]) {
  const now = Date.now();
  const seen = new Set<string>();
  for (const s of streams) {
    if (s.item.mediaType === 'Audio' || !s.device) continue;
    const key = `${s.sessionId}:${s.item.id}`;
    seen.add(key);
    const method = s.state.playMethod as Method;
    // Jellyfin sometimes reports a transcode a moment before its details:
    // wait for them rather than record a play that proves nothing.
    if (method !== 'DirectPlay' && !s.transcode) continue;
    const videoDirect = method === 'DirectPlay' || !!s.transcode?.isVideoDirect;
    const audioDirect = method === 'DirectPlay' || !!s.transcode?.isAudioDirect;
    const media = featuresOf(s);
    let cur = active.get(key);
    if (!cur) {
      const obs: Observation = { device: s.device, client: s.client, at: now, media, method, videoDirect, audioDirect, reasons: s.transcode?.reasons ?? [] };
      cur = { id: `${key}:${now}`, obs, title: s.item.seriesName ? `${s.item.seriesName} · ${s.item.title}` : s.item.title, itemId: s.item.id, json: '' };
      active.set(key, cur);
    } else {
      const o = cur.obs;
      if (RANK[method] > RANK[o.method]) o.method = method;
      o.videoDirect &&= videoDirect;
      o.audioDirect &&= audioDirect;
      o.reasons = [...new Set([...o.reasons, ...(s.transcode?.reasons ?? [])])];
      // Keep a subtitle once one was turned on: it is part of what this play proves.
      o.media = { ...media, sub: media.sub ?? o.media.sub };
    }
    const json = JSON.stringify(cur.obs);
    if (json !== cur.json) {
      cur.json = json;
      upsert.run(cur.id, deviceKey(cur.obs.device, cur.obs.client), cur.itemId, cur.title, cur.obs.at, json);
      profilesCache = undefined;
    }
  }
  for (const k of active.keys()) if (!seen.has(k)) active.delete(k);
}

export function prunePlays() {
  db.prepare('DELETE FROM device_plays WHERE at < ?').run(Date.now() - KEEP_MS);
}

/* -------------------------------- profiles -------------------------------- */

let profilesCache: { at: number; profiles: DeviceProfile[] } | undefined;

export function deviceProfiles() {
  if (profilesCache && Date.now() - profilesCache.at < 60_000) return profilesCache.profiles;
  const rows = db.prepare('SELECT data FROM device_plays WHERE at >= ?').all(Date.now() - KEEP_MS) as { data: string }[];
  const obs: Observation[] = [];
  for (const r of rows) {
    try {
      obs.push(JSON.parse(r.data) as Observation);
    } catch {
      /* skip a damaged row */
    }
  }
  const profiles = buildProfiles(obs);
  profilesCache = { at: Date.now(), profiles };
  return profiles;
}

/* --------------------------------- library --------------------------------- */

interface JfStream {
  Type: string;
  Codec?: string;
  Width?: number;
  Height?: number;
  BitDepth?: number;
  Channels?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  IsDefault?: boolean;
}
interface JfSource {
  Id: string;
  Name?: string;
  Container?: string;
  Bitrate?: number;
  Size?: number;
  MediaStreams?: JfStream[];
}
interface JfLibItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesId?: string;
  SeriesName?: string;
  ProductionYear?: number;
  MediaSources?: JfSource[];
}

export function fileFeatures(src: JfSource): FileFeatures {
  const streams = src.MediaStreams ?? [];
  const v = streams.find((x) => x.Type === 'Video');
  const a = streams.find((x) => x.Type === 'Audio' && x.IsDefault) ?? streams.find((x) => x.Type === 'Audio');
  return {
    container: normContainer(src.Container),
    vcodec: normCodec(v?.Codec),
    range: v ? normRange(v.VideoRangeType ?? v.VideoRange) : undefined,
    bitdepth: v?.BitDepth,
    res: resBucket(v?.Width, v?.Height),
    acodec: normCodec(a?.Codec),
    channels: a?.Channels,
    bitrate: src.Bitrate,
    subs: [...new Set(streams.filter((x) => x.Type === 'Subtitle').map((x) => normCodec(x.Codec)).filter((x): x is string => !!x))],
  };
}

export class PlayabilityError extends Error {}

function serverKey() {
  const key = jellyfin.serverApiKey();
  if (!key || !resolve('jellyfin').settings.url) throw new PlayabilityError('Add a Jellyfin API key in Settings so StreamForge can read your whole library.');
  return key;
}

const ITEM_FIELDS = { Fields: 'MediaSources', EnableImages: false, EnableUserData: false };


function toLibraryFile(i: JfLibItem): LibraryFile | undefined {
  const versions = (i.MediaSources ?? []).filter((s) => s.MediaStreams?.some((x) => x.Type === 'Video')).map((s) => ({ name: s.Name, features: fileFeatures(s) }));
  if (!versions.length) return undefined;
  const episode = i.Type === 'Episode';
  return {
    id: i.Id,
    titleId: episode ? (i.SeriesId ?? i.Id) : i.Id,
    title: episode ? (i.SeriesName ?? i.Name) : i.Name,
    kind: episode ? 'series' : 'movie',
    year: episode ? undefined : i.ProductionYear,
    versions,
  };
}

/** Every movie and episode file in Jellyfin, re-read at most every 6 hours. */
export function libraryFiles() {
  const key = serverKey();
  return cache.get('playability:library', 6 * 3600_000, async () => {
    const out: LibraryFile[] = [];
    const PAGE = 400;
    for (let start = 0; ; start += PAGE) {
      const res = await jellyfin.jf<{ Items: JfLibItem[]; TotalRecordCount: number }>('/Items', key, 'streamforge-server', {
        IncludeItemTypes: 'Movie,Episode',
        Recursive: true,
        IsMissing: false,
        StartIndex: start,
        Limit: PAGE,
        ...ITEM_FIELDS,
      });
      for (const i of res.Items ?? []) {
        const f = toLibraryFile(i);
        if (f) out.push(f);
      }
      if (!res.Items?.length || start + PAGE >= res.TotalRecordCount) break;
    }
    return { files: out, at: Date.now() };
  });
}

/* --------------------------------- answers --------------------------------- */

export function playabilityStatus() {
  return statusOf(deviceProfiles(), !!jellyfin.serverApiKey());
}

export async function deviceReport(key: string) {
  const profile = deviceProfiles().find((p) => p.key === key);
  if (!profile) throw new PlayabilityError('StreamForge hasn’t seen this device play anything');
  const { files, at } = await libraryFiles();
  return libraryReport(profile, files, at);
}

export async function titlePlayability(itemId: string) {
  const key = serverKey();
  const profiles = deviceProfiles();
  if (!householdDevices(profiles).length) return titleReport(profiles, []);
  const [item] = (await jellyfin.jf<{ Items: JfLibItem[] }>('/Items', key, 'streamforge-server', { Ids: itemId, ...ITEM_FIELDS })).Items ?? [];
  if (!item) throw new PlayabilityError('Jellyfin doesn’t have this item');
  const items =
    item.Type === 'Series'
      ? ((await jellyfin.jf<{ Items: JfLibItem[] }>('/Items', key, 'streamforge-server', { ParentId: item.Id, IncludeItemTypes: 'Episode', Recursive: true, IsMissing: false, ...ITEM_FIELDS })).Items ?? [])
      : [item];
  return titleReport(profiles, items.map(toLibraryFile).filter((f): f is LibraryFile => !!f));
}

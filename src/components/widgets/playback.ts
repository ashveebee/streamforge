import type { NowPlaying } from '@/lib/types';
import { episodeCode } from '@/lib/format';
import { t } from '@/i18n';

/** Position extrapolated from the last poll so progress moves every second. */
export function livePosition(s: NowPlaying, fetchedAt: number, now: number) {
  if (s.state.isPaused || !s.item.runtimeMs) return s.state.positionMs;
  return Math.min(s.item.runtimeMs, s.state.positionMs + Math.max(0, now - fetchedAt));
}

export function titleOf(s: NowPlaying) {
  const i = s.item;
  if (i.type === 'Episode') return i.seriesName ?? i.title;
  if (i.type === 'Audio') return i.title;
  return i.title;
}

export function subtitleOf(s: NowPlaying) {
  const i = s.item;
  if (i.type === 'Episode') {
    const code = episodeCode(i.seasonNumber, i.episodeNumber);
    return [code, i.title].filter(Boolean).join(' · ');
  }
  if (i.type === 'Audio') return [i.artist, i.album].filter(Boolean).join(' — ');
  return undefined;
}

/** Whether the video itself is being converted (not just remuxed or audio-only). */
export function isTranscoding(s: NowPlaying) {
  return s.state.playMethod === 'Transcode' && !s.transcode?.isVideoDirect;
}

export function methodLabel(s: NowPlaying) {
  if (s.state.playMethod === 'Transcode') return t(s.transcode?.isVideoDirect ? 'ui.method.directStream' : 'ui.method.transcode');
  return t(s.state.playMethod === 'DirectStream' ? 'ui.method.directStream' : 'ui.method.directPlay');
}

const KINDS = ['Episode', 'Movie', 'Audio', 'TvChannel', 'MusicVideo', 'Video', 'AudioBook'] as const;
export function kindLabel(type: string) {
  return (KINDS as readonly string[]).includes(type) ? t(`ui.kind.${type as (typeof KINDS)[number]}`) : type;
}

export function deviceIcon(client = '', device = '') {
  const s = `${client} ${device}`.toLowerCase();
  if (/(android tv|tv|roku|fire|tizen|webos|apple tv|shield|chromecast|kodi)/.test(s)) return 'tv';
  if (/(iphone|android|ios|mobile|phone|ipad|tablet)/.test(s)) return 'phone';
  if (/(web|chrome|firefox|safari|edge)/.test(s)) return 'web';
  return 'desktop';
}

/** A stable key for a stream; session ids are only unique within one server. */
export const streamKey = (s: NowPlaying) => `${s.server ?? 'main'}:${s.sessionId}`;

/** Where the title opens. Title pages read the main server, so extra servers' streams don't link. */
export const streamTitlePath = (s: NowPlaying) => (s.item.type === 'Audio' || s.server ? undefined : `/media/jellyfin/${s.item.id}`);

import { SessionControls } from './SessionControls';
import { motion } from 'motion/react';
import { Cpu, Gauge, Globe, Pause, Play, Server, Volume2, VolumeX, Zap } from 'lucide-react';
import { useNow } from '@/hooks/useNow';
import { jfImage, jfUserImage } from '@/lib/api';
import { bitrate, clock, pct } from '@/lib/format';
import type { NowPlaying } from '@/lib/types';
import { Avatar, FadeImage } from '../ui/Image';
import { ProgressBar } from '../ui/Progress';
import { Pill } from '../ui/Status';
import { DeviceGlyph } from './NowPlayingHero';
import { kindLabel, livePosition, methodLabel, streamTitlePath, subtitleOf, titleOf } from './playback';
import { TitleLink } from '@/components/ui/TitleLink';

function Row({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
      <div className="w-24 shrink-0 text-xs text-ink-3">{label}</div>
      <div className="min-w-0 flex-1 text-xs font-medium break-words text-ink-2">{children}</div>
    </div>
  );
}

export function StreamCard({ s, fetchedAt, index = 0 }: { s: NowPlaying; fetchedAt: number; index?: number }) {
  const now = useNow(1000, !s.state.isPaused);
  const pos = livePosition(s, fetchedAt, now);
  const progress = s.item.runtimeMs ? pos / s.item.runtimeMs : 0;
  const method = methodLabel(s);
  const t = s.transcode;
  const subtitle = subtitleOf(s);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="card flex flex-col overflow-hidden"
    >
      <div className="relative aspect-[16/8] overflow-hidden">
        <FadeImage src={jfImage(s.item.backdrop ?? s.item.thumb, 1200)} alt="" className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/50 to-transparent" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="glass inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold text-ink">
            {s.state.isPaused ? <Pause className="size-3" /> : <Play className="size-3 text-brand" />}
            {s.state.isPaused ? 'Paused' : 'Playing'}
          </span>
          {s.serverName && (
            <span className="glass inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold text-ink" title="Playing on this Jellyfin server">
              <Server className="size-3" />
              {s.serverName}
            </span>
          )}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4">
          <FadeImage
            src={jfImage(s.item.poster, 300)}
            alt=""
            className={`w-20 shrink-0 rounded-lg shadow-2xl ring-1 ring-white/10 ${s.item.type === 'Audio' ? 'aspect-square' : 'aspect-[2/3]'}`}
          />
          <div className="min-w-0 pb-1">
            <div className="mb-1.5 flex flex-wrap gap-1">
              <Pill>{kindLabel(s.item.type)}</Pill>
              {s.item.year && <Pill>{s.item.year}</Pill>}
            </div>
            <h3 className="truncate text-lg leading-tight font-semibold text-white">
              <TitleLink to={streamTitlePath(s)}>{titleOf(s)}</TitleLink>
            </h3>
            {subtitle && <p className="truncate text-sm text-ink-2">{subtitle}</p>}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 pt-3">
        <ProgressBar value={progress} height={4} label="Playback progress" />
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-3 tabular">
          <span>{clock(pos)} / {clock(s.item.runtimeMs)}</span>
          <span className="font-medium text-ink-2">{pct(progress)}</span>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-2.5">
          <Avatar src={jfUserImage(s.user.id, s.user.imageTag, 80, s.server)} name={s.user.name} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{s.user.name}</div>
            <div className="flex items-center gap-1.5 truncate text-xs text-ink-3">
              <DeviceGlyph client={s.client} device={s.device} className="size-3.5" />
              {s.device} · {s.client} {s.appVersion}
            </div>
          </div>
          {s.state.isMuted ? <VolumeX className="size-4 text-ink-4" /> : <Volume2 className="size-4 text-ink-4" />}
        </div>
        <SessionControls s={s} />

        <div className="mt-3 divide-y divide-line">
          <Row icon={Zap} label="Playback">
            <span className={method === 'Transcode' ? 'text-warn' : 'text-ok'}>{method}</span>
            {t?.hwAccel && t.hwAccel !== 'none' && <span className="text-ink-3"> · HW {t.hwAccel}</span>}
          </Row>
          <Row icon={Gauge} label="Source">
            {[s.item.resolution, s.item.hdr, s.item.videoCodec?.toUpperCase()].filter(Boolean).join(' · ') || '—'}
            {s.item.audio && <div className="text-ink-3">{s.item.audio}</div>}
          </Row>
          {t && (
            <Row icon={Cpu} label="Stream">
              {[
                t.isVideoDirect ? 'Video direct' : `${t.videoCodec?.toUpperCase() ?? ''} ${t.resolution ?? ''}`.trim(),
                t.isAudioDirect ? 'Audio direct' : t.audioCodec?.toUpperCase(),
                t.bitrate ? bitrate(t.bitrate / 8) : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
              {t.reasons.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {t.reasons.map((r) => (
                    <span key={r} className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">
                      {r.replace(/([a-z])([A-Z])/g, '$1 $2')}
                    </span>
                  ))}
                </div>
              )}
              {t.completion !== undefined && !t.isVideoDirect && (
                <div className="mt-1.5 text-ink-3">Transcoded ahead: {Math.round(t.completion)}%</div>
              )}
            </Row>
          )}
          {s.remoteAddress && (
            <Row icon={Globe} label="Address">
              <span className="font-mono">{s.remoteAddress}</span>
            </Row>
          )}
        </div>
      </div>
    </motion.article>
  );
}

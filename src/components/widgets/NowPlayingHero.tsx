import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Laptop, MonitorSmartphone, Pause, Play, Smartphone, Sparkles, Tv } from 'lucide-react';
import { useLatest, useNowPlaying } from '@/hooks/queries';
import { useNow } from '@/hooks/useNow';
import { jfImage, jfUserImage } from '@/lib/api';
import { clock, duration } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { NowPlaying } from '@/lib/types';
import { Avatar, FadeImage } from '../ui/Image';
import { ProgressBar } from '../ui/Progress';
import { Pill } from '../ui/Status';
import { ErrorState, Skeleton } from '../ui/States';
import { deviceIcon, streamKey, streamTitlePath, kindLabel, livePosition, methodLabel, subtitleOf, titleOf } from './playback';
import { TitleLink } from '../ui/TitleLink';

const DEVICE_ICONS = { tv: Tv, phone: Smartphone, web: MonitorSmartphone, desktop: Laptop };

export function DeviceGlyph({ client, device, className }: { client?: string; device?: string; className?: string }) {
  const Icon = DEVICE_ICONS[deviceIcon(client, device)];
  return <Icon className={className} />;
}

function Backdrop({ src, k }: { src?: string; k: string }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={k}
        className="absolute inset-0"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
      >
        {src && <img src={src} alt="" className="size-full object-cover object-[center_25%]" />}
      </motion.div>
    </AnimatePresence>
  );
}

function Overlays() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/80 to-canvas/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/30 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_20%_100%,rgb(139_92_246/0.18),transparent)]" />
    </>
  );
}

function StreamMeta({ s }: { s: NowPlaying }) {
  const bits = [
    s.item.year,
    s.item.officialRating,
    s.item.runtimeMs ? duration(s.item.runtimeMs) : undefined,
    s.item.genres.slice(0, 2).join(', ') || undefined,
  ].filter(Boolean);
  return <div className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">{bits.map((b, i) => <span key={i} className="flex items-center gap-2">{i > 0 && <span className="text-ink-4">•</span>}{b}</span>)}</div>;
}

function HeroStream({ s, fetchedAt }: { s: NowPlaying; fetchedAt: number }) {
  const now = useNow(1000, !s.state.isPaused);
  const pos = livePosition(s, fetchedAt, now);
  const runtime = s.item.runtimeMs;
  const progress = runtime ? pos / runtime : 0;
  const subtitle = subtitleOf(s);
  const method = methodLabel(s);
  const logo = jfImage(s.item.logo, 600);
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => setLogoOk(true), [logo]);

  return (
    <motion.div
      key={streamKey(s)}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex h-full flex-col gap-6 p-5 sm:flex-row sm:items-end sm:p-8"
    >
      <div className="hidden shrink-0 sm:block">
        <FadeImage
          src={jfImage(s.item.poster, 400)}
          alt={titleOf(s)}
          eager
          className={cn(
            'w-36 rounded-xl shadow-[0_30px_60px_-20px_rgb(0_0_0/0.9)] ring-1 ring-white/10 lg:w-44',
            s.item.type === 'Audio' ? 'aspect-square' : 'aspect-[2/3]',
          )}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-brand uppercase">
            {s.state.isPaused ? <Pause className="size-3" /> : <span className="relative flex size-1.5"><span className="absolute inset-0 animate-ping rounded-full bg-brand" /><span className="relative size-1.5 rounded-full bg-brand" /></span>}
            {s.state.isPaused ? 'Paused' : 'Now playing'}
          </span>
          <Pill>{kindLabel(s.item.type)}</Pill>
          {s.item.resolution && <Pill>{s.item.resolution}</Pill>}
          {s.item.hdr && <Pill tone="warn">{s.item.hdr}</Pill>}
          <Pill tone={method === 'Transcode' ? 'warn' : 'ok'}>{method}</Pill>
          {s.serverName && <Pill tone="brand">{s.serverName}</Pill>}
        </div>

        <div>
          {logo && logoOk && s.item.type !== 'Audio' ? (
            <img
              src={logo}
              alt={titleOf(s)}
              onError={() => setLogoOk(false)}
              className="max-h-20 max-w-[min(360px,80%)] object-contain object-left drop-shadow-[0_4px_20px_rgb(0_0_0/0.6)] lg:max-h-24"
            />
          ) : (
            <h2 className="text-3xl leading-tight font-semibold tracking-tight text-balance text-white lg:text-[40px]">
              <TitleLink to={streamTitlePath(s)}>{titleOf(s)}</TitleLink>
            </h2>
          )}
          {subtitle && <p className="mt-2 text-base font-medium text-ink lg:text-lg">{subtitle}</p>}
          <div className="mt-1.5">
            <StreamMeta s={s} />
          </div>
        </div>

        <div className="max-w-2xl">
          <ProgressBar value={progress} height={5} label="Playback progress" />
          <div className="mt-2 flex items-center justify-between text-xs text-ink-3 tabular">
            <span>{clock(pos)}</span>
            <span className="font-medium text-ink-2">{Math.round(progress * 100)}%</span>
            <span>-{clock(Math.max(0, runtime - pos))} · {clock(runtime)}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="flex items-center gap-2">
            <Avatar src={s.serverType === 'plex' ? undefined : jfUserImage(s.user.id, s.user.imageTag, 64, s.server)} name={s.user.name} size={26} />
            <span className="font-medium text-ink">{s.user.name}</span>
          </span>
          <span className="flex items-center gap-2 text-ink-2">
            <DeviceGlyph client={s.client} device={s.device} className="size-4 text-ink-3" />
            {s.device}
            <span className="text-ink-4">·</span>
            <span className="text-ink-3">{s.client}</span>
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function Switcher({ streams, active, onSelect, fetchedAt }: { streams: NowPlaying[]; active: number; onSelect: (i: number) => void; fetchedAt: number }) {
  const now = useNow(1000);
  return (
    <div className="relative z-10 flex gap-2 overflow-x-auto px-5 pb-5 no-scrollbar sm:absolute sm:top-6 sm:right-6 sm:max-w-[45%] sm:flex-col sm:overflow-visible sm:p-0">
      {streams.map((s, i) => {
        const p = s.item.runtimeMs ? livePosition(s, fetchedAt, now) / s.item.runtimeMs : 0;
        return (
          <button
            key={streamKey(s)}
            onClick={() => onSelect(i)}
            className={cn(
              'glass group flex w-56 shrink-0 items-center gap-3 rounded-xl p-2 pr-3 text-left transition sm:w-64',
              i === active ? 'border-white/20 bg-white/10' : 'opacity-70 hover:opacity-100',
            )}
          >
            <FadeImage src={jfImage(s.item.thumb ?? s.item.backdrop ?? s.item.poster, 200)} alt="" className="h-10 w-16 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-ink">{titleOf(s)}</div>
              <div className="truncate text-[11px] text-ink-3">{s.user.name} · {s.serverName ?? s.device}</div>
              <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-brand" style={{ width: `${p * 100}%` }} />
              </div>
            </div>
            {s.state.isPaused ? <Pause className="size-3.5 text-ink-3" /> : <Play className="size-3.5 text-brand" />}
          </button>
        );
      })}
    </div>
  );
}

function IdleHero() {
  const latest = useLatest();
  const feature = useMemo(() => latest.data?.find((i) => i.backdrop), [latest.data]);
  return (
    <div className="relative flex h-full items-end p-6 sm:p-8">
      <div className="max-w-lg">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
          <Sparkles className="size-3" /> All quiet
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">Nothing is playing right now</h2>
        <p className="mt-2 text-sm text-ink-2">
          {feature ? (
            <>Recently added to your library: <span className="font-medium text-ink">{feature.title}</span>{feature.year ? ` (${feature.year})` : ''}</>
          ) : (
            'Active streams from every Jellyfin client will appear here in real time.'
          )}
        </p>
      </div>
    </div>
  );
}

export function NowPlayingHero() {
  const q = useNowPlaying();
  const latest = useLatest();
  const streams = q.data ?? [];
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState(false);
  const idx = Math.min(active, Math.max(0, streams.length - 1));
  const current = streams[idx];

  // Gently rotate between simultaneous streams.
  useEffect(() => {
    if (streams.length < 2 || hover) return;
    const t = setInterval(() => setActive((a) => (a + 1) % streams.length), 12_000);
    return () => clearInterval(t);
  }, [streams.length, hover]);

  const idleBackdrop = latest.data?.find((i) => i.backdrop)?.backdrop;
  const backdrop = current ? jfImage(current.item.backdrop ?? current.item.thumb, 1920) : jfImage(idleBackdrop, 1920);

  return (
    <section
      className="card relative min-h-[420px] overflow-hidden lg:min-h-[460px]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Backdrop src={backdrop} k={backdrop ?? 'none'} />
      <Overlays />
      <div className="relative flex h-full min-h-[420px] flex-col justify-end lg:min-h-[460px]">
        {q.isPending ? (
          <div className="space-y-4 p-8">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-2/3 max-w-md" />
            <Skeleton className="h-2 w-full max-w-2xl" />
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : current ? (
          <>
            <AnimatePresence mode="wait">
              <HeroStream key={streamKey(current)} s={current} fetchedAt={q.dataUpdatedAt} />
            </AnimatePresence>
            {streams.length > 1 && <Switcher streams={streams} active={idx} onSelect={setActive} fetchedAt={q.dataUpdatedAt} />}
          </>
        ) : (
          <IdleHero />
        )}
      </div>
      {streams.length > 0 && (
        <Link
          to="/now-playing"
          className="absolute right-5 bottom-5 z-10 hidden items-center gap-1 rounded-full bg-black/30 px-3 py-1.5 text-xs text-ink-2 backdrop-blur transition hover:bg-black/50 hover:text-ink sm:inline-flex"
        >
          {streams.length} active {streams.length === 1 ? 'stream' : 'streams'} <ChevronRight className="size-3.5" />
        </Link>
      )}
    </section>
  );
}

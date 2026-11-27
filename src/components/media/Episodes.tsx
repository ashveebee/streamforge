import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AudioLines, Captions, Check, ChevronDown, CircleSlash, Clock, LoaderCircle, Play, Search, Star } from 'lucide-react';
import { useJellyfinEpisodes, useSeasonEpisodes, useTitleSearch, type Episode, type EpisodeStatus, type EpisodeWatch, type SeasonEpisode } from '@/hooks/useMedia';
import { SERVER_COLOR, SERVER_NAME } from '@/components/ui/ServerTag';
import { useAuth } from '@/hooks/useAuth';
import { bytes, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { bits, Chip, langName, longDate } from './parts';
import { WatchLink } from './WatchLink';
import { t } from '@/i18n';

const STATUS: Record<EpisodeStatus, { label: string; cls: string }> = {
  available: { get label() { return t('media.inLibrary'); }, cls: 'border-ok/30 bg-ok/10 text-ok' },
  missing: { get label() { return t('palette.status.missing'); }, cls: 'border-bad/30 bg-bad/10 text-bad' },
  unaired: { get label() { return t('dashboard.widgets.upcoming'); }, cls: 'border-line-strong bg-white/[0.04] text-ink-3' },
  unmonitored: { get label() { return t('media.ep.notMonitored'); }, cls: 'border-warn/30 bg-warn/10 text-warn' },
};

type Filter = 'all' | 'have' | 'missing';

/** "Plex · claudia: you watched it · also Reya, Dee" */
function watchTitle(w: EpisodeWatch) {
  const who = [
    w.me ? t('media.ep.youWatched') : w.progress ? t('media.ep.youreIn', { pct: w.progress }) : undefined,
    w.others
      ? w.otherNames?.length
        ? t(w.me || w.progress ? 'media.ep.also' : 'media.ep.watchedBy', { names: w.otherNames.join(', ') })
        : t('media.ep.others', { count: w.others })
      : undefined,
  ];
  return `${SERVER_NAME[w.type]} · ${w.name}: ${who.filter(Boolean).join(' · ')}`;
}

/** A tick per server in its colour: solid when you've watched it there, outlined when only someone else has. */
function WatchTicks({ list }: { list: EpisodeWatch[] }) {
  const shown = list.filter((w) => w.me || w.others);
  if (!shown.length) return null;
  return (
    <span className="absolute top-1 right-1 flex gap-0.5">
      {shown.map((w) => (
        <span
          key={w.server}
          title={watchTitle(w)}
          aria-label={watchTitle(w)}
          className="grid size-5 place-items-center rounded-full border-2 shadow-sm shadow-black/40"
          style={
            w.me
              ? { background: SERVER_COLOR[w.type], borderColor: SERVER_COLOR[w.type], color: 'black' }
              : { background: 'rgb(0 0 0 / 0.55)', borderColor: SERVER_COLOR[w.type], color: SERVER_COLOR[w.type] }
          }
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ))}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === undefined || children === null || children === '' || children === false) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] tracking-wide text-ink-4 uppercase">{label}</dt>
      <dd className="text-[13px] break-words text-ink-2">{children}</dd>
    </div>
  );
}

/** Everything about one episode, shown when it's opened. */
function EpisodeDetail({ e, seriesId }: { e: SeasonEpisode; seriesId?: number }) {
  const { user } = useAuth();
  const search = useTitleSearch();
  const f = e.file;
  const v = f?.video;
  const w = e.jellyfin?.watch;
  return (
    <div className="space-y-4 px-2 pt-1 pb-3">
      {e.overview ? <p className="text-[13px] leading-relaxed text-ink-2">{e.overview}</p> : <p className="text-[12px] text-ink-4 italic">{t('media.ep.noSummary')}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <Fact label={e.airDate && Date.parse(e.airDate) > Date.now() ? t('widgets.upcoming.airs') : t('media.ep.aired')}>{e.airDate ? `${longDate(e.airDate)} · ${relative(e.airDate)}` : undefined}</Fact>
        <Fact label={t('media.ep.runtime')}>{e.runtimeMin ? t('media.min', { n: e.runtimeMin }) : undefined}</Fact>
        <Fact label={t('media.ep.rating')}>{e.rating ? <><Star className="mr-1 inline size-3 fill-current text-warn" />{e.rating.toFixed(1)}</> : undefined}</Fact>
        <Fact label={t('library.system.status')}>{STATUS[e.status].label}{e.monitored === false && e.status !== 'unmonitored' ? ` · ${t('media.notMonitored')}` : ''}</Fact>
        {e.watched ? (
          <div className="col-span-2 min-w-0">
            <dt className="text-[10.5px] tracking-wide text-ink-4 uppercase">{t('media.watched')}</dt>
            <dd className="space-y-0.5 text-[13px] text-ink-2">
              {e.watched.length
                ? e.watched.map((x) => (
                    <div key={x.server} className="flex items-center gap-1.5">
                      <i className="size-[7px] shrink-0 rounded-full" style={{ background: SERVER_COLOR[x.type] }} />
                      <span className="truncate">{watchTitle(x)}</span>
                    </div>
                  ))
                : t('media.notYet')}
            </dd>
          </div>
        ) : (
          <Fact label={t('media.watched')}>{w ? (w.played ? `${t('media.yes')}${w.playCount > 1 ? ` · ${t('media.ep.times', { count: w.playCount })}` : ''}` : w.progress ? `${w.progress}% · ${t('media.minLeft', { n: w.remainingMin ?? '?' })}` : t('media.notYet')) : undefined}</Fact>
        )}
        <Fact label={t('media.lastPlayed')}>{w?.lastPlayed ? relative(w.lastPlayed) : undefined}</Fact>
        <Fact label={t('media.ep.quality')}>{e.quality ?? v?.resolution}</Fact>
        <Fact label={t('media.info.size')}>{e.size ? bytes(e.size) : undefined}</Fact>
        <Fact label={t('media.info.bitrate')}>{bits(f?.bitrate)}</Fact>
      </dl>
      {f && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {v?.resolution && <Chip tone="brand">{v.resolution}</Chip>}
            {v?.range && <Chip tone="brand">{v.range}</Chip>}
            {v?.codec && <Chip>{v.codec}</Chip>}
            {v?.bitDepth && v.bitDepth > 8 ? <Chip>{v.bitDepth}-bit</Chip> : null}
            {f.container && <Chip>{f.container.toUpperCase()}</Chip>}
          </div>
          {(f.audio.length > 0 || f.subtitles.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0 text-[12px]">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-ink-3"><AudioLines className="size-3.5" /> {t('widgets.devices.kind.acodec')}</div>
                <div className="text-ink-2">{f.audio.map((a) => [langName(a.language) ?? a.title, a.codec, a.channels].filter(Boolean).join(' ')).join(' · ') || '—'}</div>
              </div>
              <div className="min-w-0 text-[12px]">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-ink-3"><Captions className="size-3.5" /> {t('widgets.devices.kind.sub')}</div>
                <div className="text-ink-2">
                  {f.subtitles.map((s) => [langName(s.language) ?? s.title, s.forced && `(${t('media.info.forced').toLocaleLowerCase()})`, s.sdh && '(SDH)'].filter(Boolean).join(' ')).join(' · ') || t('media.ep.none')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {e.path && <p className="truncate font-mono text-[10.5px] text-ink-4" title={e.path}>{e.path}</p>}
      <div className="flex flex-wrap gap-2">
        {e.jellyfin && (
          <WatchLink
            itemId={e.jellyfin.id}
            jellyfinUrl={e.jellyfin.url}
            play
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-white px-3.5 text-[13px] font-semibold text-black transition hover:bg-white/90"
          >
            {(app) => (
              <>
                <Play className="size-3.5 fill-current" /> {t(w?.progress ? 'media.resumeIn' : 'media.playIn', { app })}
              </>
            )}
          </WatchLink>
        )}
        {user?.isAdmin && e.sonarr && seriesId && e.status !== 'unaired' && (
          <Button
            size="sm"
            variant={e.status === 'available' ? 'ghost' : 'primary'}
            disabled={search.isPending || search.isSuccess}
            onClick={() => search.mutate({ kind: 'sonarr', instance: e.sonarr!.instance, id: seriesId, episodeIds: [e.sonarr!.episodeId], title: `S${e.season}E${e.number}` })}
          >
            {search.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : search.isSuccess ? <Check className="size-3.5" /> : <Search className="size-3.5" />}
            {search.isSuccess ? t('media.ep.searchingSonarr') : e.status === 'available' ? t('media.ep.better') : t('media.ep.searchSonarr')}
          </Button>
        )}
      </div>
      {search.error && <p className="text-xs text-bad">{(search.error as Error).message}</p>}
    </div>
  );
}

function EpisodeItem({ e, seriesId }: { e: SeasonEpisode; seriesId?: number }) {
  const [open, setOpen] = useState(false);
  const w = e.jellyfin?.watch;
  const have = e.status === 'available';
  // Your progress on whichever server you're partway through it.
  const progress = e.watched ? e.watched.find((x) => x.progress)?.progress : w?.progress;
  return (
    <li className={cn('rounded-xl transition', open && 'bg-white/[0.03] ring-1 ring-line')}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.04]">
        <div className={cn('relative w-28 shrink-0 sm:w-36', !have && 'opacity-60 grayscale-[60%]')}>
          <FadeImage src={e.still} alt="" className="aspect-video rounded-lg ring-1 ring-white/10" fallback={<div className="grid size-full place-items-center bg-surface-3 text-[11px] text-ink-4">E{e.number}</div>} />
          {e.watched ? (
            <WatchTicks list={e.watched} />
          ) : (
            w?.played && (
              <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-ok text-black" aria-label={t('media.watched')}>
                <Check className="size-3" strokeWidth={3} />
              </span>
            )
          )}
          {progress ? <ProgressBar value={progress / 100} height={3} glow={false} className="absolute inset-x-1.5 bottom-1.5 w-auto" label={t('media.watched')} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 truncate text-[13px] font-medium">
              <span className="text-ink-4">{e.number}. </span>
              {e.name}
            </div>
            <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-4">
            {!have && <span className={cn('rounded border px-1.5 py-px text-[10px] font-medium', STATUS[e.status].cls)}>{STATUS[e.status].label}</span>}
            {e.airDate && <span>{longDate(e.airDate)}</span>}
            {e.runtimeMin && <span>{t('media.min', { n: e.runtimeMin })}</span>}
            {have && (e.quality ?? e.file?.video?.resolution) && <span>{e.quality ?? e.file?.video?.resolution}</span>}
          </div>
          {!open && e.overview && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">{e.overview}</p>}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <EpisodeDetail e={e} seriesId={seriesId} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function EpisodeList({ episodes, seriesId, sonarr }: { episodes: SeasonEpisode[]; seriesId?: number; sonarr?: { instance: string; seriesId: number } }) {
  const { user } = useAuth();
  const search = useTitleSearch();
  const [filter, setFilter] = useState<Filter>('all');
  const missing = episodes.filter((e) => e.status === 'missing');
  const have = episodes.filter((e) => e.status === 'available').length;
  const upcoming = episodes.filter((e) => e.status === 'unaired').length;
  const shown = episodes.filter((e) => (filter === 'all' ? true : filter === 'have' ? e.status === 'available' : e.status !== 'available'));
  const missingIds = missing.map((e) => e.sonarr?.episodeId).filter((x): x is number => !!x);
  return (
    <div className="px-2 pt-1 pb-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <div className="flex gap-1" role="group" aria-label={t('media.ep.show')}>
          {(
            [
              ['all', t('media.ep.all', { n: episodes.length })],
              ['have', t('media.ep.have', { n: have })],
              ['missing', `${t('media.ep.missing', { n: episodes.length - have - upcoming })}${upcoming ? ` + ${t('media.ep.upcoming', { n: upcoming })}` : ''}`],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              aria-pressed={filter === k}
              className={cn('rounded-lg border px-2 py-0.5 text-[11.5px] transition', filter === k ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
            >
              {label}
            </button>
          ))}
        </div>
        {episodes.some((e) => e.watched?.length) && (
          <div className="flex items-center gap-2.5 text-[11px] text-ink-4" aria-hidden>
            <span className="inline-flex items-center gap-1"><span className="grid size-3.5 place-items-center rounded-full bg-ink-3 text-black"><Check className="size-2.5" strokeWidth={3} /></span>{t('media.ep.you')}</span>
            {user?.isAdmin && <span className="inline-flex items-center gap-1"><span className="grid size-3.5 place-items-center rounded-full border-[1.5px] border-ink-3 text-ink-3"><Check className="size-2.5" strokeWidth={3} /></span>{t('media.ep.someone')}</span>}
            <span>· {t('media.ep.colour')}</span>
          </div>
        )}
        {user?.isAdmin && sonarr && missingIds.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={search.isPending || search.isSuccess}
            onClick={() => search.mutate({ kind: 'sonarr', instance: sonarr.instance, id: sonarr.seriesId, episodeIds: missingIds, title: t('media.ep.missingEpisodes', { count: missingIds.length }) })}
          >
            {search.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : search.isSuccess ? <Check className="size-3.5 text-ok" /> : <Search className="size-3.5" />}
            {search.isSuccess ? t('widgets.missing.searching') : t('media.ep.searchMissing', { n: missingIds.length })}
          </Button>
        )}
      </div>
      {search.error && <p className="mb-2 px-1 text-xs text-bad">{(search.error as Error).message}</p>}
      {shown.length ? (
        <ul className="space-y-1">
          {shown.map((e) => (
            <EpisodeItem key={e.number} e={e} seriesId={seriesId ?? sonarr?.seriesId} />
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-1 py-3 text-[12px] text-ink-4">
          {filter === 'have' ? <CircleSlash className="size-3.5" /> : <Clock className="size-3.5" />}
          {filter === 'have' ? t('media.ep.noneHave') : t('media.ep.noneMissing')}
        </p>
      )}
    </div>
  );
}

const Loading = () => (
  <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-ink-4">
    <LoaderCircle className="size-3.5 animate-spin" /> {t('media.ep.loading')}
  </div>
);

/** Every episode of a season of a TMDB series, including missing ones. */
export function SeasonEpisodeList({ tmdbId, season }: { tmdbId: number; season: number }) {
  const q = useSeasonEpisodes(tmdbId, season);
  if (q.isPending) return <Loading />;
  if (q.isError) return <p className="px-3 py-4 text-[12px] text-bad">{(q.error as Error).message}</p>;
  if (!q.data.episodes.length) return <p className="px-3 py-4 text-[12px] text-ink-4">{q.data.sources.tmdb || q.data.sources.sonarr ? t('media.ep.noList') : t('media.ep.noListConnect')}</p>;
  return <EpisodeList episodes={q.data.episodes} sonarr={q.data.sonarr} />;
}

/** A season of a series Jellyfin can't match to TMDB: only what Jellyfin has. */
export function JellyfinEpisodeList({ seriesId, seasonId }: { seriesId: string; seasonId: string }) {
  const q = useJellyfinEpisodes(seriesId, seasonId);
  if (q.isPending) return <Loading />;
  if (q.isError) return <p className="px-3 py-4 text-[12px] text-bad">{(q.error as Error).message}</p>;
  const episodes: SeasonEpisode[] = q.data.episodes.map((e: Episode) => ({
    number: e.number ?? 0,
    season: e.season ?? 0,
    name: e.name,
    overview: e.overview,
    airDate: e.airDate,
    runtimeMin: e.runtimeMin,
    rating: e.rating,
    still: e.still,
    status: 'available',
    size: e.size,
    path: e.path,
    file: e.resolution ? { id: e.id, video: { resolution: e.resolution }, audio: [], subtitles: [] } : undefined,
    jellyfin: { id: e.id, url: e.url, watch: e.watch },
  }));
  if (!episodes.length) return <p className="px-3 py-4 text-[12px] text-ink-4">{t('media.ep.noJellyfin')}</p>;
  return <EpisodeList episodes={episodes} />;
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  Clock,
  ExternalLink,
  HardDrive,
  Heart,
  Inbox,
  Info,
  Library,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Send,
  Star,
  Users,
  X,
} from 'lucide-react';
import { useDecideRequest } from '@/hooks/queries';
import {
  useInvalidateMedia,
  useJellyfinMedia,
  useMediaDetails,
  useTitleSearch,
  type Availability,
  type CastMember,
  type Episode,
  type LibraryInfo,
  type MediaFile,
  type TitleWatcher,
  type MediaDetails as Details,
  type MediaType,
  type Season,
  type WatchState,
} from '@/hooks/useMedia';
import { useRequestMedia } from '@/hooks/useSearch';
import { AddToArrDialog } from '@/components/media/AddToArrDialog';
import { bytes, dayLabel, relative } from '@/lib/format';
import { History as HistoryIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { PageLoader } from '@/components/ui/Loader';
import { Pill } from '@/components/ui/Status';
import { JellyfinEpisodeList, SeasonEpisodeList } from '@/components/media/Episodes';
import { WatchLink } from '@/components/media/WatchLink';
import { WillItPlay } from '@/components/media/WillItPlay';
import { episodeLabel, longDate, MediaInfo, Row } from '@/components/media/parts';
import { ProgressBar } from '@/components/ui/Progress';
import { ErrorState } from '@/components/ui/States';
import { MEDIA_SERVERS, SERVICES } from '@/components/ui/ServiceIcon';
import { ServerTag } from '@/components/ui/ServerTag';
import { Avatar } from '@/components/ui/Image';

const AVAILABILITY: Record<Availability, { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' }> = {
  available: { label: 'Available', tone: 'ok' },
  partial: { label: 'Partly available', tone: 'brand' },
  processing: { label: 'Downloading', tone: 'brand' },
  requested: { label: 'Requested', tone: 'brand' },
  missing: { label: 'Missing', tone: 'warn' },
  none: { label: 'Not in your library', tone: 'neutral' },
};

const REQUEST_TONE: Record<string, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'> = { pending: 'warn', approved: 'brand', completed: 'ok', declined: 'bad', failed: 'bad' };

function Back() {
  const navigate = useNavigate();
  return (
    <button onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))} className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-3 transition hover:text-ink">
      <ArrowLeft className="size-3.5" /> Back
    </button>
  );
}

function Hero({ title, year, tagline, poster, backdrop, facts, servers, children }: { title: string; year?: number; tagline?: string; poster?: string; backdrop?: string; facts: React.ReactNode; servers?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative -mx-4 mb-6 overflow-hidden sm:mx-0 sm:rounded-[1.5rem] sm:border sm:border-line">
      <div className="absolute inset-0">
        {backdrop && <FadeImage src={backdrop} alt="" eager className="size-full" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/80 to-[#07080c]/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07080c]/90 via-[#07080c]/40 to-transparent" />
      </div>
      {/* Phones: poster beside the title, facts and buttons full width below.
          Wider: poster on the left, everything else stacked beside it. */}
      <div className="relative grid grid-cols-[6rem_minmax(0,1fr)] gap-x-4 p-4 pt-20 sm:grid-cols-[12rem_minmax(0,1fr)] sm:grid-rows-[1fr_auto_auto_auto] sm:gap-x-6 sm:p-8 sm:pt-40">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="self-end sm:row-span-4">
          <FadeImage src={poster} alt="" eager className="aspect-[2/3] rounded-xl shadow-2xl ring-1 ring-white/15" fallback={<div className="grid size-full place-items-center bg-surface-3"><Clapperboard className="size-8 text-ink-4" /></div>} />
        </motion.div>
        <div className="min-w-0 self-end">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words text-white sm:text-4xl">
            {title} {year ? <span className="font-normal text-white/50">({year})</span> : null}
          </h1>
          {tagline && <p className="mt-1 text-[13px] text-white/60 italic sm:text-sm">{tagline}</p>}
        </div>
        <div className="col-span-2 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/70 sm:col-span-1 sm:col-start-2 sm:mt-3">{facts}</div>
        {servers && <div className="col-span-2 mt-3 sm:col-span-1 sm:col-start-2">{servers}</div>}
        {children && (
          <div className="col-span-2 mt-4 grid grid-cols-2 gap-2 sm:col-span-1 sm:col-start-2 sm:mt-5 sm:flex sm:flex-wrap sm:items-center max-sm:[&>*]:justify-center max-sm:[&>:first-child:nth-last-child(odd)]:col-span-2 max-sm:[&>p]:col-span-2">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

function Cast({ cast }: { cast: CastMember[] }) {
  if (!cast.length) return null;
  return (
    <Card>
      <CardHeader icon={Users} accent="var(--color-seerr)" title="Cast" />
      <CardBody>
        <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 no-scrollbar">
          {cast.map((c, i) => (
            <div key={`${c.name}-${i}`} className="w-24 shrink-0 snap-start text-center">
              <FadeImage src={c.image} alt="" className="mx-auto aspect-[2/3] w-24 rounded-lg ring-1 ring-white/10" fallback={<div className="grid size-full place-items-center bg-surface-3 text-lg font-semibold text-ink-4">{c.name.charAt(0)}</div>} />
              <div className="mt-1.5 truncate text-[12px] font-medium" title={c.name}>{c.name}</div>
              {c.character && <div className="truncate text-[11px] text-ink-4" title={c.character}>{c.character}</div>}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/** Everyone who has watched it, on which server and device (admins). */
function WhoWatched({ list, runtimeMin, several }: { list: TitleWatcher[]; runtimeMin?: number; several: boolean }) {
  return (
    <Card>
      <CardHeader icon={HistoryIcon} title="Who’s watched it" subtitle={several ? 'Across every server' : `${list.length} ${list.length === 1 ? 'person' : 'people'}`} />
      <CardBody>
        <ul className="-mx-2">
          {list.map((w) => {
            const pctWatched = w.watchedMs && runtimeMin ? Math.min(100, Math.round((w.watchedMs / (runtimeMin * 60_000)) * 100)) : undefined;
            const state = w.source === 'server' || (pctWatched !== undefined && pctWatched >= 90) ? 'Finished' : pctWatched ? `${pctWatched}%` : 'Watched';
            return (
              <li key={w.user}>
                <Link
                  to={`/history?user=${encodeURIComponent(w.user)}&days=0${w.serverId ? `&server=${encodeURIComponent(w.serverId)}` : ''}`}
                  className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.04]"
                >
                  <Avatar name={w.user} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium transition group-hover:text-brand">{w.user}</div>
                    <div className="truncate text-[11px] text-ink-4">
                      {state} · {relative(w.at)}
                      {w.plays > 1 ? ` · ${w.plays} plays` : ''}
                    </div>
                  </div>
                  <div className="hidden min-w-0 items-center gap-2 text-[11px] text-ink-3 sm:flex">
                    {several && w.serverType && <ServerTag type={w.serverType} name={w.serverName} />}
                    {(w.device || w.client) && <span className="truncate text-ink-4">{w.device ?? w.client}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/** The title's files on the media server. */
function allCopies(d: Details): { files: MediaFile[]; subtitle?: string } {
  return { files: d.library?.files ?? d.availableOn?.[0]?.files ?? [] };
}

function Actions({ d }: { d: Details }) {
  const request = useRequestMedia();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const refresh = useInvalidateMedia();
  const done = () => refresh(d.type, d.tmdbId);
  const err = request.error as Error | null;
  const partial = d.type === 'tv' && (d.availability === 'partial' || d.seasons?.some((s) => s.status === 'available'));
  return (
    <>
      {d.jellyfin && (
        <PlayButton itemId={d.jellyfin.itemId} url={d.jellyfin.url} library={d.library} />
      )}
      <PlayOnServer d={d} />
      {d.can.request && (
        <Button variant="primary" disabled={request.isPending || request.isSuccess} onClick={() => request.mutate({ mediaType: d.type, tmdbId: d.tmdbId, title: d.title }, { onSuccess: done })}>
          {request.isPending ? <LoaderCircle className="size-4 animate-spin" /> : request.isSuccess ? <Check className="size-4" /> : <Send className="size-4" />}
          {request.isSuccess ? (
            'Requested'
          ) : partial ? (
            <>
              <span className="sm:hidden">Request the rest</span>
              <span className="max-sm:hidden">Request missing seasons</span>
            </>
          ) : (
            'Request'
          )}
        </Button>
      )}
      {d.can.add && (
        <Button disabled={added} onClick={() => setAdding(true)}>
          {added ? <Check className="size-4" /> : <Plus className="size-4" />}
          {added ? 'Added' : `Add to ${d.type === 'tv' ? 'Sonarr' : 'Radarr'}…`}
        </Button>
      )}
      {adding && (
        <AddToArrDialog
          kind={d.type === 'tv' ? 'sonarr' : 'radarr'}
          items={[{ tmdbId: d.tmdbId, title: d.title, year: d.year }]}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdded(true);
            done();
          }}
        />
      )}
      {d.trailer && (
        <a href={d.trailer} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-4 text-sm font-medium text-white transition hover:bg-white/[0.12]">
          <Play className="size-4" /> Trailer
        </a>
      )}
      {err && <p role="alert" className="basis-full text-xs text-bad">{err.message}</p>}
    </>
  );
}

/** With Plex or Emby: opens the title in the server's own app, in its colour. */
function PlayOnServer({ d }: { d: Details }) {
  const a = !d.jellyfin ? d.availableOn?.find((x) => x.url && /^https?:\/\//.test(x.url)) : undefined;
  if (!a) return null;
  return (
    <a
      href={a.url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-black transition hover:brightness-110"
      style={{ background: MEDIA_SERVERS[a.type].color }}
    >
      <Play className="size-4 fill-current" /> Play on {MEDIA_SERVERS[a.type].name}
    </a>
  );
}

function PlayButton({ itemId, url, library }: { itemId: string; url?: string; library?: LibraryInfo }) {
  const next = library?.nextUp;
  const resume = library?.watch?.progress;
  return (
    <WatchLink
      itemId={next?.id ?? itemId}
      jellyfinUrl={next?.url ?? url}
      play={!!(next || resume)}
      chooser
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90"
    >
      {(app) => (
        <>
          <Play className="size-4 fill-current" /> {next ? `${next.watch?.progress ? 'Resume' : 'Play'} ${episodeLabel(next)}` : resume ? 'Resume' : `Play in ${app}`}
        </>
      )}
    </WatchLink>
  );
}

/** "Watched", "34% watched", "3 unwatched"… for the hero. */
function watchLabel(w: WatchState | undefined, tv: boolean) {
  if (!w) return undefined;
  if (w.progress) return `${w.progress}% watched${w.remainingMin ? ` · ${w.remainingMin} min left` : ''}`;
  if (tv && w.unplayed) return `${w.unplayed} unwatched episode${w.unplayed === 1 ? '' : 's'}`;
  if (w.played) return 'Watched';
  return undefined;
}

/** Your copy in Jellyfin: watch state, when it was added, ratings, location. */
function YourLibrary({ lib }: { lib: LibraryInfo }) {
  const w = lib.watch;
  const tv = lib.kind === 'Series';
  const watched = tv && lib.episodeCount && w?.unplayed !== undefined ? lib.episodeCount - w.unplayed : undefined;
  return (
    <Card>
      <CardHeader
        icon={Library}
        accent="var(--color-jellyfin)"
        title="In your library"
        subtitle="Jellyfin"
        action={w?.favorite ? <Heart className="size-4 fill-current text-pink-400" aria-label="Favourite" /> : undefined}
      />
      <CardBody>
        {tv && lib.episodeCount ? (
          <div className="mb-3">
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span className="text-ink-2">{watched ?? 0} of {lib.episodeCount} episodes watched</span>
              <span className="text-ink-4">{lib.seasonCount} season{lib.seasonCount === 1 ? '' : 's'}</span>
            </div>
            <ProgressBar value={(watched ?? 0) / lib.episodeCount} glow={false} label="Episodes watched" />
          </div>
        ) : w?.progress ? (
          <div className="mb-3">
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span className="text-ink-2">{w.progress}% watched</span>
              {w.remainingMin && <span className="text-ink-4">{w.remainingMin} min left</span>}
            </div>
            <ProgressBar value={w.progress / 100} glow={false} label="Watched" />
          </div>
        ) : null}
        <dl className="divide-y divide-line">
          {!tv && <Row label="Watched">{w?.played ? <span className="inline-flex items-center gap-1 text-ok"><CircleCheck className="size-3.5" /> Yes</span> : 'Not yet'}</Row>}
          <Row label="Plays">{w?.playCount ? `${w.playCount}` : undefined}</Row>
          <Row label="Last played">{w?.lastPlayed ? relative(w.lastPlayed) : undefined}</Row>
          <Row label="Added">{lib.added ? `${longDate(lib.added)} · ${relative(lib.added)}` : undefined}</Row>
          <Row label={tv ? 'First aired' : 'Released'}>{longDate(lib.premiered)}</Row>
          <Row label="Ended">{longDate(lib.ended)}</Row>
          <Row label="Status">{lib.seriesStatus}</Row>
          <Row label="Ratings">
            {lib.communityRating || lib.criticRating ? (
              <span className="inline-flex flex-wrap gap-x-3">
                {lib.communityRating ? <span><Star className="mr-1 inline size-3 fill-current text-warn" />{lib.communityRating.toFixed(1)}</span> : null}
                {lib.criticRating ? <span>🍅 {lib.criticRating}%</span> : null}
              </span>
            ) : undefined}
          </Row>
          <Row label="Location">{lib.path ? <span className="font-mono text-[11px] text-ink-3">{lib.path}</span> : undefined}</Row>
        </dl>
      </CardBody>
    </Card>
  );
}

function People({ label, names }: { label: string; names: string[] }) {
  return names.length ? <Row label={label}>{names.join(', ')}</Row> : null;
}

/** Crew, studios, tags and links to the title on other sites. */
function TitleInfo({ lib }: { lib: LibraryInfo }) {
  const any = lib.directors.length || lib.writers.length || lib.producers.length || lib.studios.length || lib.tags.length || lib.links.length || lib.originalTitle;
  if (!any) return null;
  return (
    <Card>
      <CardHeader icon={Info} accent="var(--color-jellyfin)" title="Details" />
      <CardBody>
        <dl className="divide-y divide-line">
          <Row label="Original title">{lib.originalTitle}</Row>
          <People label={lib.directors.length > 1 ? 'Directors' : 'Director'} names={lib.directors} />
          <People label={lib.writers.length > 1 ? 'Writers' : 'Writer'} names={lib.writers} />
          <People label={lib.producers.length > 1 ? 'Producers' : 'Producer'} names={lib.producers} />
          <People label={lib.studios.length > 1 ? 'Studios' : 'Studio'} names={lib.studios} />
          {lib.tags.length > 0 && (
            <Row label="Tags">
              <span className="flex flex-wrap gap-1">
                {lib.tags.map((t) => (
                  <span key={t} className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-ink-3">{t}</span>
                ))}
              </span>
            </Row>
          )}
          {lib.links.length > 0 && (
            <Row label="Links">
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {lib.links.map((l) => (
                  <a key={l.label} href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
                    {l.label} <ExternalLink className="size-3" />
                  </a>
                ))}
              </span>
            </Row>
          )}
        </dl>
      </CardBody>
    </Card>
  );
}

function EpisodeRow({ e }: { e: Episode }) {
  const w = e.watch;
  const body = (
    <>
      <div className="relative w-28 shrink-0 sm:w-36">
        <FadeImage src={e.still} alt="" className="aspect-video rounded-lg ring-1 ring-white/10" fallback={<div className="grid size-full place-items-center bg-surface-3"><Play className="size-4 text-ink-4" /></div>} />
        {w?.played && (
          <span className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-ok text-black" aria-label="Watched">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
        {w?.progress ? <ProgressBar value={w.progress / 100} height={3} glow={false} className="absolute inset-x-1.5 bottom-1.5 w-auto" label="Watched" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">
          {e.number !== undefined && <span className="text-ink-4">{e.number}. </span>}
          {e.name}
        </div>
        <div className="truncate text-[11px] text-ink-4">{[e.airDate && longDate(e.airDate), e.runtimeMin && `${e.runtimeMin} min`, e.resolution, e.size && bytes(e.size)].filter(Boolean).join(' · ')}</div>
        {e.overview && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">{e.overview}</p>}
      </div>
    </>
  );
  return (
    <li>
      <WatchLink itemId={e.id} jellyfinUrl={e.url} play className="-mx-2 flex w-[calc(100%+1rem)] gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.04]">
        {body}
      </WatchLink>
    </li>
  );
}

/** What's next for you in a series, from Jellyfin. */
function UpNext({ e }: { e: Episode }) {
  return (
    <Card>
      <CardHeader icon={Play} accent="var(--color-jellyfin)" title={e.watch?.progress ? 'Continue watching' : 'Up next'} subtitle={episodeLabel(e)} />
      <CardBody>
        <ul>
          <EpisodeRow e={e} />
        </ul>
      </CardBody>
    </Card>
  );
}

function InYourApps({ d }: { d: Details }) {
  const search = useTitleSearch();
  if (!d.arr.length) return null;
  return (
    <Card>
      <CardHeader icon={HardDrive} accent={d.type === 'tv' ? 'var(--color-sonarr)' : 'var(--color-radarr)'} title="In your apps" subtitle={d.type === 'tv' ? 'Sonarr' : 'Radarr'} />
      <CardBody>
        <ul className="divide-y divide-line">
          {d.arr.map((a) => (
            <li key={a.instance} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: SERVICES[a.kind].color }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{a.instanceName}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {[
                    a.kind === 'sonarr' ? `${a.files ?? 0} of ${a.total ?? 0} episodes` : a.downloaded ? 'Downloaded' : 'Not downloaded',
                    a.quality,
                    a.sizeOnDisk ? bytes(a.sizeOnDisk) : undefined,
                    a.monitored ? 'monitored' : 'not monitored',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {a.path && <div className="truncate font-mono text-[10.5px] text-ink-4" title={a.path}>{a.path}</div>}
              </div>
              {d.can.search && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={search.isPending || (search.isSuccess && search.variables?.instance === a.instance)}
                  onClick={() => search.mutate({ kind: a.kind, instance: a.instance, id: a.id, title: d.title })}
                >
                  {search.isPending && search.variables?.instance === a.instance ? <LoaderCircle className="size-3.5 animate-spin" /> : search.isSuccess && search.variables?.instance === a.instance ? <Check className="size-3.5 text-ok" /> : <Search className="size-3.5" />}
                  {search.isSuccess && search.variables?.instance === a.instance ? 'Searching' : 'Search now'}
                </Button>
              )}
              <Link to={`/${a.kind}${a.primary ? '' : `?instance=${encodeURIComponent(a.instance)}`}`} className="text-[11px] text-ink-4 hover:text-ink-2">Open {SERVICES[a.kind].name}</Link>
            </li>
          ))}
        </ul>
        {search.error && <p className="mt-2 text-xs text-bad">{(search.error as Error).message}</p>}
      </CardBody>
    </Card>
  );
}

function Requests({ d }: { d: Details }) {
  const decide = useDecideRequest();
  const refresh = useInvalidateMedia();
  if (!d.requests.length) return null;
  return (
    <Card>
      <CardHeader icon={Inbox} accent="var(--color-seerr)" title="Requests" subtitle="From Seerr" />
      <CardBody>
        <ul className="divide-y divide-line">
          {d.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{r.requestedBy}</div>
                <div className="text-[11px] text-ink-4">
                  {relative(r.createdAt)}
                  {r.seasons.length ? ` · season${r.seasons.length > 1 ? 's' : ''} ${r.seasons.join(', ')}` : ''}
                  {r.is4k ? ' · 4K' : ''}
                </div>
              </div>
              <Pill tone={REQUEST_TONE[r.status] ?? 'neutral'}>{r.status}</Pill>
              {d.can.approve && r.status === 'pending' && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'approve' }, { onSuccess: () => refresh(d.type, d.tmdbId) })}>
                    <Check className="size-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, decision: 'decline' }, { onSuccess: () => refresh(d.type, d.tmdbId) })}>
                    <X className="size-3.5" /> Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {decide.error && <p className="mt-2 text-xs text-bad">{(decide.error as Error).message}</p>}
      </CardBody>
    </Card>
  );
}

const SEASON_TONE: Record<Availability, string> = {
  available: 'bg-ok',
  partial: 'bg-brand',
  processing: 'bg-brand',
  requested: 'bg-seerr',
  missing: 'bg-warn',
  none: 'bg-white/15',
};

function SeasonRow({ s, tmdbId, seriesId }: { s: Season; tmdbId?: number; seriesId?: string }) {
  const [open, setOpen] = useState(false);
  const jf = seriesId ? s.jellyfin : undefined;
  const watched = jf && jf.unplayed === 0 && jf.episodes > 0;
  const missing = s.episodes !== undefined && s.files !== undefined && s.status !== 'none' ? Math.max(0, s.episodes - s.files) : 0;
  const browsable = !!tmdbId || !!jf;
  const head = (
    <>
      <span className={cn('size-2 shrink-0 rounded-full', SEASON_TONE[s.status])} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{s.name}</div>
        <div className="truncate text-[11px] text-ink-4">
          {[
            s.episodes !== undefined ? (s.files !== undefined ? `${s.files}/${s.episodes} episodes` : `${s.episodes} episodes`) : s.files !== undefined ? `${s.files} episodes` : undefined,
            missing ? `${missing} not in library` : undefined,
            s.airDate ? dayLabel(s.airDate) : undefined,
            jf && (watched ? 'watched' : jf.unplayed ? `${jf.unplayed} unwatched` : undefined),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {watched ? <CircleCheck className="size-4 shrink-0 text-ok" aria-label="Watched" /> : <span className="shrink-0 text-[11px] text-ink-3">{AVAILABILITY[s.status].label}</span>}
    </>
  );
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-white/[0.02]">
      {browsable ? (
        <>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-white/[0.03]">
            {head}
            <ChevronDown className={cn('size-4 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
          </button>
          {open && (tmdbId ? <SeasonEpisodeList tmdbId={tmdbId} season={s.number} /> : <JellyfinEpisodeList seriesId={seriesId!} seasonId={jf!.id} />)}
        </>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2.5">{head}</div>
      )}
    </li>
  );
}

function Seasons({ seasons, tmdbId, seriesId }: { seasons?: Season[]; tmdbId?: number; seriesId?: string }) {
  if (!seasons?.length) return null;
  const browsable = !!tmdbId || (seriesId && seasons.some((x) => x.jellyfin));
  return (
    <Card>
      <CardHeader
        icon={Clapperboard}
        accent="var(--color-sonarr)"
        title="Seasons"
        subtitle={`${seasons.length} season${seasons.length === 1 ? '' : 's'}${browsable ? ' · open one for every episode' : ''}`}
      />
      <CardBody className="max-sm:px-3">
        <ul className="space-y-2">
          {seasons.map((x) => (
            <SeasonRow key={x.number} s={x} tmdbId={tmdbId} seriesId={seriesId} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function Facts({ items }: { items: (React.ReactNode | undefined | false)[] }) {
  return (
    <>
      {items.filter(Boolean).map((x, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {x}
        </span>
      ))}
    </>
  );
}

function DetailsView({ d }: { d: Details }) {
  const a = AVAILABILITY[d.availability];
  return (
    <>
      <Hero
        title={d.title}
        year={d.year}
        tagline={d.tagline}
        poster={d.poster}
        backdrop={d.backdrop}
        facts={
          <Facts
            items={[
              <Pill key="a" tone={a.tone}>{a.label}</Pill>,
              <span key="t">{d.type === 'tv' ? 'Series' : 'Movie'}</span>,
              watchLabel(d.library?.watch, d.type === 'tv') && (
                <span key="w" className="text-white">
                  {d.library?.watch?.played && <CircleCheck className="mr-1 inline size-3 text-ok" />}
                  {watchLabel(d.library?.watch, d.type === 'tv')}
                </span>
              ),
              d.library?.files[0]?.video?.resolution && <span key="q" className="rounded border border-white/25 px-1 text-[10px]">{[d.library.files[0].video.resolution, d.library.files[0].video.range].filter(Boolean).join(' ')}</span>,
              d.certification && <span key="c" className="rounded border border-white/25 px-1 text-[10px]">{d.certification}</span>,
              d.runtimeMin && <span key="r"><Clock className="mr-1 inline size-3" />{d.runtimeMin} min</span>,
              d.rating && <span key="s"><Star className="mr-1 inline size-3 fill-current text-warn" />{d.rating.toFixed(1)}</span>,
              d.network,
              d.status,
              d.genres.slice(0, 4).join(', '),
            ]}
          />
        }
      >
        <Actions d={d} />
      </Hero>
      {/* min-w-0 keeps wide rows (cast, tracks) scrolling inside their card
          instead of stretching the page past the screen on phones. */}
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          {d.overview && (
            <Card>
              <CardBody className="pt-5">
                <p className="text-[14px] leading-relaxed text-ink-2">{d.overview}</p>
              </CardBody>
            </Card>
          )}
          {d.library?.nextUp && <UpNext e={d.library.nextUp} />}
          <Seasons seasons={d.seasons} tmdbId={d.type === 'tv' ? d.tmdbId : undefined} seriesId={d.library?.itemId} />
          {(() => {
            const c = allCopies(d);
            return c.files.length ? <MediaInfo files={c.files} subtitle={c.subtitle} /> : null;
          })()}
          {d.watchers && d.watchers.length > 0 && <WhoWatched list={d.watchers} runtimeMin={d.runtimeMin} several={false} />}
          <Cast cast={d.cast} />
        </div>
        <div className="min-w-0 space-y-5">
          {d.library && <YourLibrary lib={d.library} />}
          {d.library && <WillItPlay itemId={d.library.itemId} />}
          {d.library && <TitleInfo lib={d.library} />}
          <InYourApps d={d} />
          <Requests d={d} />
          {!d.sources.seerr && (
            <p className="flex items-start gap-1.5 text-[11px] text-ink-4">
              <CircleAlert className="mt-0.5 size-3 shrink-0" /> Connect Seerr in Settings for cast, trailers, seasons and requests.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

export function MediaPage() {
  const params = useParams();
  const type = params.type as MediaType;
  const tmdbId = Number(params.id);
  const q = useMediaDetails(type, tmdbId);
  return (
    <>
      <Back />
      {q.data ? (
        <DetailsView d={q.data} />
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : (
        <PageLoader label="Loading title details" hint="Gathering details from Seerr, Jellyfin and your apps…" />
      )}
    </>
  );
}

/** A Jellyfin item: switches to the full details when it has a TMDB id. */
export function JellyfinMediaPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useJellyfinMedia(id);
  useEffect(() => {
    if (q.data?.redirect) navigate(`/media/${q.data.redirect.type}/${q.data.redirect.tmdbId}`, { replace: true });
  }, [q.data, navigate]);
  const j = q.data?.jellyfinOnly;
  return (
    <>
      <Back />
      {j ? (
        <>
          <Hero
            title={j.title}
            year={j.year}
            tagline={j.tagline}
            poster={j.poster}
            backdrop={j.backdrop}
            facts={<Facts items={[<Pill key="a" tone="ok">In Jellyfin</Pill>, j.kind, watchLabel(j.library.watch, j.kind === 'Series'), j.certification, j.runtimeMin && `${j.runtimeMin} min`, j.rating && `★ ${j.rating.toFixed(1)}`, j.genres.slice(0, 4).join(', ')]} />}
          >
            <PlayButton itemId={j.itemId} url={j.url} library={j.library} />
          </Hero>
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
            <div className="min-w-0 space-y-5 xl:col-span-2">
              {j.overview && <Card><CardBody className="pt-5"><p className="text-[14px] leading-relaxed text-ink-2">{j.overview}</p></CardBody></Card>}
              {j.library.nextUp && <UpNext e={j.library.nextUp} />}
              <Seasons seasons={j.seasons.filter((x) => x.number > 0).map((x) => ({ number: x.number, name: x.name, files: x.episodes, status: 'available', jellyfin: x }))} seriesId={j.itemId} />
              <MediaInfo files={j.library.files} />
              <Cast cast={j.cast} />
            </div>
            <div className="min-w-0 space-y-5">
              <YourLibrary lib={j.library} />
              <WillItPlay itemId={j.itemId} />
              <TitleInfo lib={j.library} />
            </div>
          </div>
        </>
      ) : q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : (
        <PageLoader label="Loading title details" hint="Looking it up in Jellyfin…" />
      )}
    </>
  );
}

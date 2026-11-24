import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  CircleAlert,
  Clapperboard,
  Clock,
  ExternalLink,
  HardDrive,
  Inbox,
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
import { useInvalidateMedia, useJellyfinMedia, useMediaDetails, useTitleSearch, type Availability, type CastMember, type MediaDetails as Details, type MediaType } from '@/hooks/useMedia';
import { useAddMedia, useRequestMedia } from '@/hooks/useSearch';
import { bytes, dayLabel, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { PageLoader } from '@/components/ui/Loader';
import { Pill } from '@/components/ui/Status';
import { ErrorState } from '@/components/ui/States';
import { SERVICES } from '@/components/ui/ServiceIcon';

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

function Hero({ title, year, tagline, poster, backdrop, facts, children }: { title: string; year?: number; tagline?: string; poster?: string; backdrop?: string; facts: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative -mx-4 mb-6 overflow-hidden sm:mx-0 sm:rounded-[1.5rem] sm:border sm:border-line">
      <div className="absolute inset-0">
        {backdrop && <FadeImage src={backdrop} alt="" eager className="size-full" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/80 to-[#07080c]/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07080c]/90 via-[#07080c]/40 to-transparent" />
      </div>
      <div className="relative flex flex-col gap-6 p-5 pt-24 sm:flex-row sm:items-end sm:p-8 sm:pt-40">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-32 shrink-0 sm:w-48">
          <FadeImage src={poster} alt="" eager className="aspect-[2/3] rounded-xl shadow-2xl ring-1 ring-white/15" fallback={<div className="grid size-full place-items-center bg-surface-3"><Clapperboard className="size-8 text-ink-4" /></div>} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {title} {year ? <span className="font-normal text-white/50">({year})</span> : null}
          </h1>
          {tagline && <p className="mt-1 text-sm text-white/60 italic">{tagline}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/70">{facts}</div>
          {children && <div className="mt-5 flex flex-wrap items-center gap-2">{children}</div>}
        </div>
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

function Actions({ d }: { d: Details }) {
  const request = useRequestMedia();
  const add = useAddMedia();
  const refresh = useInvalidateMedia();
  const done = () => refresh(d.type, d.tmdbId);
  const err = (request.error ?? add.error) as Error | null;
  const partial = d.type === 'tv' && (d.availability === 'partial' || d.seasons?.some((s) => s.status === 'available'));
  return (
    <>
      {d.jellyfin?.url && (
        <a href={d.jellyfin.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90">
          <Play className="size-4 fill-current" /> Play in Jellyfin
        </a>
      )}
      {d.can.request && (
        <Button variant="primary" disabled={request.isPending || request.isSuccess} onClick={() => request.mutate({ mediaType: d.type, tmdbId: d.tmdbId, title: d.title }, { onSuccess: done })}>
          {request.isPending ? <LoaderCircle className="size-4 animate-spin" /> : request.isSuccess ? <Check className="size-4" /> : <Send className="size-4" />}
          {request.isSuccess ? 'Requested' : partial ? 'Request missing seasons' : 'Request'}
        </Button>
      )}
      {d.can.add && (
        <Button disabled={add.isPending || add.isSuccess} onClick={() => add.mutate({ kind: d.type === 'tv' ? 'sonarr' : 'radarr', tmdbId: d.tmdbId, title: d.title }, { onSuccess: done })}>
          {add.isPending ? <LoaderCircle className="size-4 animate-spin" /> : add.isSuccess ? <Check className="size-4" /> : <Plus className="size-4" />}
          {add.isSuccess ? `Added to ${add.data?.instance}` : `Add to ${d.type === 'tv' ? 'Sonarr' : 'Radarr'}`}
        </Button>
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

function Seasons({ d }: { d: Details }) {
  if (!d.seasons?.length) return null;
  const tone: Record<Availability, string> = {
    available: 'bg-ok',
    partial: 'bg-brand',
    processing: 'bg-brand',
    requested: 'bg-seerr',
    missing: 'bg-warn',
    none: 'bg-white/15',
  };
  return (
    <Card>
      <CardHeader icon={Clapperboard} accent="var(--color-sonarr)" title="Seasons" subtitle={`${d.seasons.length} season${d.seasons.length === 1 ? '' : 's'}`} />
      <CardBody>
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.seasons.map((s) => (
            <li key={s.number} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
              <span className={cn('size-2 shrink-0 rounded-full', tone[s.status])} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{s.name}</div>
                <div className="text-[11px] text-ink-4">
                  {[s.episodes !== undefined ? (s.files !== undefined ? `${s.files}/${s.episodes} episodes` : `${s.episodes} episodes`) : undefined, s.airDate ? dayLabel(s.airDate) : undefined].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="text-[11px] text-ink-3">{AVAILABILITY[s.status].label}</span>
            </li>
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
      <div className="grid items-start gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {d.overview && (
            <Card>
              <CardBody className="pt-5">
                <p className="text-[14px] leading-relaxed text-ink-2">{d.overview}</p>
              </CardBody>
            </Card>
          )}
          <Seasons d={d} />
          <Cast cast={d.cast} />
        </div>
        <div className="space-y-5">
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
            poster={j.poster}
            backdrop={j.backdrop}
            facts={<Facts items={[<Pill key="a" tone="ok">In Jellyfin</Pill>, j.kind, j.certification, j.runtimeMin && `${j.runtimeMin} min`, j.rating && `★ ${j.rating.toFixed(1)}`, j.genres.slice(0, 4).join(', ')]} />}
          >
            {j.url && (
              <a href={j.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90">
                <Play className="size-4 fill-current" /> Play in Jellyfin <ExternalLink className="size-3.5" />
              </a>
            )}
          </Hero>
          <div className="space-y-5">
            {j.overview && <Card><CardBody className="pt-5"><p className="text-[14px] leading-relaxed text-ink-2">{j.overview}</p></CardBody></Card>}
            <Cast cast={j.cast} />
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

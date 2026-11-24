import { CalendarClock, Clapperboard, Clock, Film, HardDrive, LoaderCircle, Newspaper, PlayCircle, Send, Tv } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useDigest, useDigestSettings, useSaveDigest, useSendDigest } from '@/hooks/useServices';
import { bytes, duration, relative } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { Select } from '@/components/ui/Input';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { TitleLink } from '@/components/ui/TitleLink';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Schedule() {
  const q = useDigestSettings(true);
  const save = useSaveDigest();
  const send = useSendDigest();
  const d = q.data;
  if (!d) return null;
  return (
    <Card>
      <CardHeader
        icon={CalendarClock}
        accent="var(--color-brand)"
        title="Send it every week"
        subtitle={d.lastSent ? `Last sent ${relative(d.lastSent)}` : 'Goes to notification channels subscribed to “Weekly digest”'}
        action={<Switch checked={d.enabled} disabled={save.isPending || !d.canSend} onChange={(v) => save.mutate({ enabled: v })} label="Send the digest every week" />}
      />
      <CardBody>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          Every
          <Select aria-label="Day" className="h-8 w-36 text-xs" value={d.day} onChange={(e) => save.mutate({ day: Number(e.target.value) })}>
            {DAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </Select>
          at
          <Select aria-label="Hour" className="h-8 w-24 text-xs" value={d.hour} onChange={(e) => save.mutate({ hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </Select>
          <span className="text-ink-4">(server time)</span>
          <Button size="sm" className="ml-auto" disabled={send.isPending || !d.canSend} onClick={() => send.mutate()}>
            {send.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send now
          </Button>
        </div>
        {!d.canSend && <p className="mt-2 text-xs text-warn">Add a Jellyfin API key in Settings to send the digest.</p>}
        {(send.error ?? save.error) && <p className="mt-2 text-xs text-bad">{((send.error ?? save.error) as Error).message}</p>}
        {send.isSuccess && <p className="mt-2 text-xs text-ok">Sent.</p>}
      </CardBody>
    </Card>
  );
}

export default function DigestPage() {
  const { user } = useAuth();
  const q = useDigest();
  return (
    <>
      <PageHeader eyebrow="This week" title="Weekly digest" description="What’s new in the library and what everyone’s been watching over the last seven days." />
      <QueryState query={q} skeleton={<PageLoader label="Putting this week together" hint="Collecting what was added and watched…" />}>
        {(d) => {
          const nothing = !d.added.movies.length && !d.added.shows.length && !d.added.other.length;
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="New movies" value={d.added.movies.length} icon={Film} accent="var(--color-radarr)" />
                <StatTile label="Shows with new episodes" value={d.added.shows.length} icon={Tv} accent="var(--color-sonarr)" hint={`${d.added.shows.reduce((n, s) => n + s.episodes, 0)} episodes`} />
                {d.watched ? (
                  <StatTile label="Hours watched" value={d.watched.watchedMs / 3_600_000} format={(n) => String(Math.round(n))} icon={Clock} accent="var(--color-brand)" hint={`${d.watched.plays} plays by ${d.watched.viewers}`} />
                ) : (
                  <StatTile label="New runtime" value={d.added.runtimeMs} format={(n) => duration(n)} icon={Clock} accent="var(--color-brand)" />
                )}
                <StatTile label="Storage used" value={d.storage.used} format={(n) => bytes(n)} icon={HardDrive} accent="var(--color-infinidisk)" hint={d.storage.soonest ? `${d.storage.soonest.label} full in ~${d.storage.soonest.daysLeft} days` : d.storage.total ? `of ${bytes(d.storage.total)}` : undefined} />
              </div>
              {nothing ? (
                <Card><EmptyState icon={Newspaper} title="A quiet week" description="Nothing new was added in the last seven days." /></Card>
              ) : (
                <>
                  {d.added.movies.length > 0 && (
                    <Card>
                      <CardHeader icon={Film} accent="var(--color-radarr)" title="New movies" />
                      <CardBody>
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
                          {d.added.movies.map((m) => (
                            <TitleLink key={m.id} to={`/media/jellyfin/${m.id}`} className="block min-w-0">
                              <FadeImage src={m.image} alt="" className="aspect-[2/3] rounded-lg ring-1 ring-white/10" fallback={<div className="grid size-full place-items-center bg-surface-3"><Clapperboard className="size-6 text-ink-4" /></div>} />
                              <div className="mt-1 truncate text-[12px] font-medium" title={m.title}>{m.title}</div>
                              {m.year && <div className="text-[11px] text-ink-4">{m.year}</div>}
                            </TitleLink>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  )}
                  {d.added.shows.length > 0 && (
                    <Card>
                      <CardHeader icon={Tv} accent="var(--color-sonarr)" title="New episodes" />
                      <CardBody>
                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
                          {d.added.shows.map((s) => (
                            <TitleLink key={s.id} to={`/media/jellyfin/${s.id}`} className="block min-w-0">
                              <FadeImage src={s.image} alt="" className="aspect-[2/3] rounded-lg ring-1 ring-white/10" fallback={<div className="grid size-full place-items-center bg-surface-3"><Tv className="size-6 text-ink-4" /></div>} />
                              <div className="mt-1 truncate text-[12px] font-medium" title={s.title}>{s.title}</div>
                              <div className="text-[11px] text-ink-4">{s.episodes} episode{s.episodes === 1 ? '' : 's'}</div>
                            </TitleLink>
                          ))}
                        </div>
                      </CardBody>
                    </Card>
                  )}
                  {d.added.other.length > 0 && (
                    <Card>
                      <CardHeader icon={Newspaper} title="Music and books" />
                      <CardBody>
                        <div className="flex flex-wrap gap-1.5">{d.added.other.map((o) => <Pill key={o.id}>{o.title}</Pill>)}</div>
                      </CardBody>
                    </Card>
                  )}
                </>
              )}
              {d.watched && d.watched.top.length > 0 && (
                <Card>
                  <CardHeader icon={PlayCircle} accent="var(--color-brand)" title="Most watched this week" />
                  <CardBody>
                    <ol className="divide-y divide-line">
                      {d.watched.top.map((t, i) => (
                        <li key={t.title} className="flex items-center gap-3 py-2 text-[13px]">
                          <span className="w-5 text-right font-semibold text-ink-4 tabular">{i + 1}</span>
                          <span className="flex-1 truncate font-medium">{t.title}</span>
                          <span className="text-xs text-ink-3 tabular">{t.plays} play{t.plays === 1 ? '' : 's'}</span>
                        </li>
                      ))}
                    </ol>
                  </CardBody>
                </Card>
              )}
              {user?.isAdmin && <Schedule />}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

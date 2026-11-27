import { Clock, History, Inbox, LaptopMinimal, ListVideo, LoaderCircle, LogOut, PlayCircle, Repeat, SkipForward } from 'lucide-react';
import { useMainServer } from '@/hooks/queries';
import { useAuth } from '@/hooks/useAuth';
import { useEndSession, useMe, useMyRequests, useMySessions, type MeCard } from '@/hooks/useMe';
import { jfImage, jfUserImage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { duration, relative } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Avatar, FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState, SkeletonRows } from '@/components/ui/States';
import { REQUEST_TONE } from '@/components/widgets/RequestsWidget';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { TitleLink } from '@/components/ui/TitleLink';
import { ScrollRow } from '@/components/ui/ScrollRow';

function Shelf({ items, empty }: { items: MeCard[]; empty: string }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-ink-4">{empty}</p>;
  return (
    <ScrollRow label="titles">
      {items.map((i) => (
        <TitleLink key={i.id} to={`/media/jellyfin/${i.id}`} className="block w-56 shrink-0 snap-start">
          <div className="relative overflow-hidden rounded-xl border border-line">
            <FadeImage src={jfImage(i.image, 480)} alt="" className="aspect-video" fallback={<div className="size-full bg-gradient-to-br from-jellyfin/25 to-surface-3" />} />
            {i.progress !== undefined && i.progress > 0 && <ProgressBar value={i.progress} height={3} glow={false} className="absolute inset-x-0 bottom-0 rounded-none" />}
          </div>
          <div className="mt-1.5 truncate text-[13px] font-medium">{i.title}</div>
          <div className="truncate text-[11px] text-ink-3">{[i.subtitle, i.remainingMs ? `${duration(i.remainingMs)} left` : undefined].filter(Boolean).join(' · ')}</div>
        </TitleLink>
      ))}
    </ScrollRow>
  );
}

function deviceName(ua?: string) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

function Devices() {
  const q = useMySessions();
  const end = useEndSession();
  return (
    <Card>
      <CardHeader icon={LaptopMinimal} accent="var(--color-brand)" title="Signed-in devices" subtitle="Sign out anywhere you don’t recognise" />
      <CardBody>
        {!q.data ? (
          <SkeletonRows rows={2} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {deviceName(s.userAgent)} {s.current && <Pill tone="ok">This device</Pill>} {s.method === 'oidc' && <Pill>Single sign-on</Pill>}
                  </div>
                  <div className="text-[11px] text-ink-4">Signed in {relative(s.createdAt)} · last active {relative(s.lastSeenAt)}</div>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" disabled={end.isPending} onClick={() => end.mutate(s.id)}>
                    {end.isPending && end.variables === s.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />} Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export default function MePage() {
  const { user } = useAuth();
  const main = useMainServer();
  const q = useMe();
  const reqs = useMyRequests(!!q.data?.requestsAvailable);
  return (
    <>
      <PageHeader
        icon={user ? <Avatar src={jfUserImage(user.id, user.imageTag, 160)} name={user.name} size={52} /> : undefined}
        eyebrow="Your account"
        title={user?.name ?? 'Me'}
        description="What you’re watching, what you’ve asked for, and where you’re signed in."
      />
      <QueryState query={q} skeleton={<PageLoader label="Loading your activity" hint="Fetching what you’re watching…" />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Plays in 30 days" value={d.month.plays} icon={PlayCircle} accent="var(--color-jellyfin)" />
              <StatTile label="Watch time in 30 days" value={d.month.watchedMs} format={(n) => duration(n)} icon={Clock} accent="var(--color-brand)" />
              <StatTile label="In progress" value={d.resume.length} icon={ListVideo} accent="var(--color-sonarr)" />
              <StatTile label="Up next" value={d.nextUp.length} icon={SkipForward} accent="var(--color-radarr)" />
            </div>
            <Card>
              <CardHeader icon={ListVideo} accent="var(--color-jellyfin)" title="Continue watching" />
              <CardBody><Shelf items={d.resume} empty="Nothing in progress." /></CardBody>
            </Card>
            <Card>
              <CardHeader icon={SkipForward} accent="var(--color-sonarr)" title="Next up" subtitle="The next episode of shows you’re watching" />
              <CardBody><Shelf items={d.nextUp} empty="You’re all caught up." /></CardBody>
            </Card>
            <div className="grid items-start gap-5 xl:grid-cols-2">
              {d.requestsAvailable && (
                <Card>
                  <CardHeader icon={Inbox} accent="var(--color-seerr)" title="My requests" subtitle="Tip: press ⌘K to search and request something new" />
                  <CardBody>
                    {!reqs.data ? (
                      <SkeletonRows rows={3} />
                    ) : !reqs.data.linked ? (
                      <EmptyState icon={Inbox} title="Not linked to Seerr" description={`Sign in to Seerr once with your ${main.name} account and your requests will show up here.`} />
                    ) : !reqs.data.requests.length ? (
                      <EmptyState icon={Inbox} title="No requests yet" />
                    ) : (
                      <ul className="divide-y divide-line">
                        {reqs.data.requests.map((r) => (
                          <li key={r.id} className="flex items-center gap-3 py-2">
                            <FadeImage src={r.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
                            <div className="min-w-0 flex-1">
                              <TitleLink to={r.tmdbId ? `/media/${r.type}/${r.tmdbId}` : undefined} className="block truncate text-[13px] font-medium">{r.title} {r.year ? <span className="font-normal text-ink-4">({r.year})</span> : null}</TitleLink>
                              <div className="text-[11px] text-ink-4">{r.type === 'tv' ? 'Series' : 'Movie'} · requested {relative(r.createdAt)}</div>
                            </div>
                            <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold capitalize', REQUEST_TONE[r.status])}>
                              {r.status === 'approved' && r.mediaStatus === 'available' ? 'available' : r.status === 'approved' ? r.mediaStatus : r.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardBody>
                </Card>
              )}
              <Card>
                <CardHeader icon={History} accent="var(--color-brand)" title="Watch history" subtitle="Recorded by StreamForge" />
                <CardBody>
                  {!d.history.length ? (
                    <EmptyState icon={History} title="No history yet" description={main.other ? 'Your plays will show up here as you watch.' : 'StreamForge records plays when a Jellyfin API key is set in Settings.'} />
                  ) : (
                    <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
                      {d.history.map((h, n) => (
                        <li key={n} className="flex items-center gap-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{h.title}{h.subtitle ? <span className="font-normal text-ink-3"> · {h.subtitle}</span> : null}</div>
                            <div className="truncate text-[11px] text-ink-4">{[relative(h.at), duration(h.watchedMs), h.client].filter(Boolean).join(' · ')}</div>
                          </div>
                          {h.transcoded && <Repeat className="size-3.5 shrink-0 text-warn" aria-label="Transcoded" />}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-2">
        <Devices />
        <SecuritySection />
      </div>
    </>
  );
}

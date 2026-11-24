import { BookOpen, CalendarDays, Disc3, Download, HardDrive, Library, LoaderCircle, Music, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMusic, useMusicQueueRemove, type MusicKind } from '@/hooks/useServices';
import { bytes, dayLabel, num } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/States';
import { MissingCard } from '@/components/widgets/MissingCard';

const WORDS = {
  lidarr: { creators: 'Artists', releases: 'Albums', files: 'Tracks on disk', icon: Music, release: Disc3 },
  readarr: { creators: 'Authors', releases: 'Books', files: 'Book files', icon: BookOpen, release: BookOpen },
} as const;

function Page({ kind }: { kind: MusicKind }) {
  const q = useMusic(kind);
  const { user } = useAuth();
  const remove = useMusicQueueRemove(kind);
  const w = WORDS[kind];
  const color = `var(--color-${kind})`;
  return (
    <>
      <ServiceHeader id={kind} />
      <QueryState query={q} skeleton={<Skeleton className="h-96 rounded-[1.25rem]" />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={w.creators} value={d.stats.creators} icon={Users} accent={color} hint={`${num(d.stats.monitored)} monitored`} />
              <StatTile label={w.releases} value={d.stats.releases} icon={w.release} accent={color} />
              <StatTile label={w.files} value={d.stats.files} icon={Library} accent={color} hint={d.stats.total ? `of ${num(d.stats.total)}` : undefined} />
              <StatTile label="On disk" value={d.stats.sizeOnDisk} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-2">
              <Card>
                <CardHeader icon={Download} accent={color} title="Queue" subtitle={`${d.queue.length} downloading`} />
                <CardBody>
                  {!d.queue.length ? (
                    <EmptyState icon={Download} title="Nothing downloading" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.queue.map((i) => (
                        <li key={i.id} className="py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium">{i.title}{i.subtitle ? <span className="font-normal text-ink-3"> · {i.subtitle}</span> : null}</div>
                              <div className="truncate text-[11px] text-ink-4" title={i.releaseTitle}>{[i.quality, i.client, i.timeLeft ? `${i.timeLeft} left` : undefined].filter(Boolean).join(' · ')}</div>
                            </div>
                            <Pill tone={i.errorMessage ? 'bad' : 'neutral'}>{i.status}</Pill>
                            {user?.isAdmin && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-8"
                                aria-label={`Remove ${i.title} and blocklist the release`}
                                title="Remove and blocklist"
                                disabled={remove.isPending}
                                onClick={() => confirm(`Remove “${i.releaseTitle}” from the queue and blocklist it?`) && remove.mutate({ id: i.id, blocklist: true })}
                              >
                                {remove.isPending && remove.variables?.id === i.id ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                              </Button>
                            )}
                          </div>
                          <ProgressBar value={i.progress} className="mt-2" />
                          {i.errorMessage && <p className="mt-1 text-[11px] text-bad">{i.errorMessage}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {remove.error && <p className="mt-2 text-xs text-bad">{(remove.error as Error).message}</p>}
                </CardBody>
              </Card>
              <Card>
                <CardHeader icon={CalendarDays} accent={color} title="Coming up" subtitle="Releases in the next 60 days" />
                <CardBody>
                  {!d.upcoming.length ? (
                    <EmptyState icon={CalendarDays} title="Nothing scheduled" />
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.upcoming.map((u) => (
                        <li key={u.id} className="flex items-center gap-3 py-2">
                          <FadeImage src={u.cover} alt="" className="size-10 shrink-0 rounded-md ring-1 ring-white/10" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{u.title}</div>
                            <div className="truncate text-[11px] text-ink-3">{u.creator}</div>
                          </div>
                          <span className="shrink-0 text-[11px] text-ink-4">{dayLabel(u.date)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
            <MissingCard kind={kind} instance={kind} />
          </div>
        )}
      </QueryState>
    </>
  );
}

export const LidarrPage = () => <Page kind="lidarr" />;
export const ReadarrPage = () => <Page kind="readarr" />;

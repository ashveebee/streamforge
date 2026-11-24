import { Clapperboard, Film, LoaderCircle, MonitorPlay, RefreshCw, Repeat, ScanSearch, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLibraryScan } from '@/hooks/useServices';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { JellyfinTasks } from '@/components/widgets/JellyfinTasks';
import { useJellyfin } from '@/hooks/queries';
import { jfImage, jfUserImage } from '@/lib/api';
import { relative } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Avatar, FadeImage } from '@/components/ui/Image';
import { KV, StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { QueryState, Skeleton } from '@/components/ui/States';
import { ActivityWidget } from '@/components/widgets/ActivityWidget';
import { LIBRARY_ICONS } from '@/components/widgets/LibraryWidget';
import { PlaysWidget } from '@/components/widgets/PlaysWidget';
import { RecentlyAddedWidget } from '@/components/widgets/RecentlyAddedWidget';

export default function JellyfinPage() {
  const q = useJellyfin();
  const { user } = useAuth();
  const scan = useLibraryScan();
  return (
    <>
      <ServiceHeader id="jellyfin" />
      <QueryState query={q} skeleton={<Skeleton className="h-96 rounded-[1.25rem]" />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Active streams" value={d.sessions.streams} icon={MonitorPlay} accent="var(--color-jellyfin)" hint={`${d.sessions.active} connected sessions`} />
              <StatTile label="Transcoding" value={d.sessions.transcoding} icon={Repeat} accent="var(--color-warn)" hint={`${d.sessions.directPlay} direct`} />
              <StatTile label="Users" value={d.users.total} icon={Users} accent="var(--color-seerr)" hint={`${d.users.active24h} active in 24h`} />
              <StatTile label="Titles" value={d.counts.movies + d.counts.series} icon={Film} accent="var(--color-radarr)" hint={`${d.counts.movies.toLocaleString()} movies · ${d.counts.series.toLocaleString()} series`} />
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader
                  icon={Clapperboard}
                  accent="var(--color-jellyfin)"
                  title="Libraries"
                  subtitle={scan.error ? <span className="text-bad">{(scan.error as Error).message}</span> : `${d.libraries.length} libraries`}
                  action={
                    user?.isAdmin ? (
                      <Button size="sm" disabled={scan.isPending} onClick={() => scan.mutate({})}>
                        {scan.isPending && !scan.variables?.library ? <LoaderCircle className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} Scan all
                      </Button>
                    ) : undefined
                  }
                />
                <CardBody>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {d.libraries.map((l) => {
                      const Icon = LIBRARY_ICONS[l.type] ?? Clapperboard;
                      return (
                        <div key={l.id} className="group relative overflow-hidden rounded-2xl border border-line">
                          <FadeImage src={jfImage(l.image, 600)} alt="" className="aspect-video" imgClassName="transition-transform duration-700 group-hover:scale-105" fallback={<div className="size-full bg-gradient-to-br from-jellyfin/30 to-surface-3" />} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm font-semibold text-white"><Icon className="size-3.5" />{l.name}</div>
                              <div className="truncate text-[11px] text-white/60">{l.locations[0]}</div>
                            </div>
                            <span className="text-lg font-semibold text-white tabular">{l.itemCount?.toLocaleString() ?? '—'}</span>
                          </div>
                          {l.refreshing && <div className="absolute top-2 left-2"><Pill tone="brand">Scanning {Math.round(l.refreshProgress ?? 0)}%</Pill></div>}
                          {user?.isAdmin && (
                            <div className="absolute top-1.5 right-1.5 rounded-lg bg-black/40 text-white backdrop-blur">
                              <Menu
                                label={`Actions for ${l.name}`}
                                busy={scan.isPending && scan.variables?.library === l.id}
                                items={[
                                  { label: 'Scan for new files', icon: ScanSearch, onSelect: () => scan.mutate({ library: l.id, name: l.name }) },
                                  {
                                    label: 'Refresh all metadata',
                                    icon: RefreshCw,
                                    hint: 'Slow on large libraries',
                                    onSelect: () => confirm(`Replace all metadata in ${l.name}? This can take a long time.`) && scan.mutate({ library: l.id, name: l.name, full: true }),
                                  },
                                ]}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader icon={MonitorPlay} title="Server" subtitle={d.server.name} />
                <CardBody>
                  <div className="divide-y divide-line">
                    <KV k="Version" v={d.server.version} />
                    <KV k="Operating system" v={d.server.os ?? '—'} />
                    <KV k="Architecture" v={d.server.architecture ?? '—'} />
                    <KV k="Update available" v={d.server.hasUpdateAvailable ? <Pill tone="brand">Yes</Pill> : 'No'} />
                    <KV k="Restart pending" v={d.server.hasPendingRestart ? <Pill tone="warn">Yes</Pill> : 'No'} />
                    <KV k="Episodes" v={d.counts.episodes.toLocaleString()} />
                    <KV k="Songs" v={d.counts.songs.toLocaleString()} />
                    <KV k="Books" v={d.counts.books.toLocaleString()} />
                    <KV k="Collections" v={d.counts.collections.toLocaleString()} />
                  </div>
                </CardBody>
              </Card>
            </div>

            <RecentlyAddedWidget />

            <div className="grid gap-5 xl:grid-cols-3">
              <div className="xl:col-span-2"><PlaysWidget /></div>
              <Card>
                <CardHeader icon={Users} title="Users" subtitle="Most recently active first" />
                <CardBody>
                  <ul className="space-y-1">
                    {d.users.list.slice(0, 8).map((u) => (
                      <li key={u.id} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
                        <Avatar src={jfUserImage(u.id, u.imageTag)} name={u.name} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{u.name}</div>
                          <div className="text-[11px] text-ink-4">{u.lastActivity ? `Active ${relative(u.lastActivity)}` : 'Never active'}</div>
                        </div>
                        {u.isAdmin && <Pill>Admin</Pill>}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </div>
            {user?.isAdmin && <JellyfinTasks />}
            <ActivityWidget limit={15} />
          </div>
        )}
      </QueryState>
    </>
  );
}


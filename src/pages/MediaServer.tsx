import { Clapperboard, Film, Plus, LoaderCircle, MonitorPlay, RefreshCw, Repeat, ScanSearch, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLibraryScan } from '@/hooks/useServices';
import { Button } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { JellyfinTasks } from '@/components/widgets/JellyfinTasks';
import { useJellyfin } from '@/hooks/queries';
import { jfImage, jfUserImage } from '@/lib/api';
import { relative } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { MediaServerTabs, useSelectedMediaServer, useServersOfType } from '@/components/layout/InstanceTabs';
import { Link } from 'react-router';
import { MEDIA_SERVERS } from '@/components/ui/ServiceIcon';
import { EmptyState } from '@/components/ui/States';
import type { MediaServerType } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Avatar, FadeImage } from '@/components/ui/Image';
import { KV, StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { QueryState } from '@/components/ui/States';
import { ActivityWidget } from '@/components/widgets/ActivityWidget';
import { LIBRARY_ICONS } from '@/components/widgets/LibraryWidget';
import { PlaysWidget } from '@/components/widgets/PlaysWidget';
import { RecentlyAddedWidget } from '@/components/widgets/RecentlyAddedWidget';
import { PageLoader } from '@/components/ui/Loader';
import { getLocale, t } from '@/i18n';

/** Emby and Plex pages before any server of that kind has been added. */
function NoServers({ type }: { type: MediaServerType }) {
  const { user } = useAuth();
  const name = MEDIA_SERVERS[type].name;
  return (
    <>
      <ServiceHeader id="jellyfin" media={type} />
      <Card>
        <EmptyState
          icon={MEDIA_SERVERS[type].icon}
          title={t('svc.server.none', { server: name })}
          description={t('svc.server.noneHint', { server: name })}
          action={
            user?.isAdmin ? (
              <Link to="/settings" className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-medium text-ink-2 hover:bg-white/[0.06]">
                <Plus className="size-3.5" /> {t('svc.server.add', { server: name })}
              </Link>
            ) : undefined
          }
        />
      </Card>
    </>
  );
}

/** The media server's page (Jellyfin, Emby, Plex or Silo). */
export default function MediaServerPage({ type = 'jellyfin' }: { type?: MediaServerType }) {
  const server = useSelectedMediaServer(type);
  if (!server) return <NoServers type={type} />;
  return <ServerView key={server} type={type} server={server} />;
}

function ServerView({ type, server }: { type: MediaServerType; server: string }) {
  const extra = server !== 'jellyfin' ? server : undefined;
  // The sign-in server (main Jellyfin, or main Plex) gets scans and play history.
  const isMain = useServersOfType(type).find((s) => s.id === server)?.primary ?? server === 'jellyfin';
  const typeName = MEDIA_SERVERS[type].name;
  const accent = MEDIA_SERVERS[type].color;
  const q = useJellyfin(server);
  const { user } = useAuth();
  // Scans, tasks and play history are only available for the main server.
  const admin = !!user?.isAdmin && isMain;
  const scan = useLibraryScan();
  return (
    <>
      <ServiceHeader id="jellyfin" instance={extra} media={type} />
      <MediaServerTabs type={type} />
      <QueryState key={server} query={q} skeleton={<PageLoader label={t('svc.server.loading', { server: typeName })} hint={t('svc.server.loadingHint')} />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('watch.now.active')} value={d.sessions.streams} icon={MonitorPlay} accent={accent} hint={t('svc.server.sessions', { count: d.sessions.active })} />
              <StatTile label={t('watch.now.transcoding')} value={d.sessions.transcoding} icon={Repeat} accent="var(--color-warn)" hint={t('svc.server.direct', { count: d.sessions.directPlay })} />
              <StatTile label={t('widgets.library.users')} value={d.users.total} icon={Users} accent="var(--color-seerr)" hint={t('svc.server.active24', { count: d.users.active24h })} />
              <StatTile label={t('svc.server.titles')} value={d.counts.movies + d.counts.series} icon={Film} accent="var(--color-radarr)" hint={`${t('media.add.movies', { count: d.counts.movies })} · ${t('media.add.series', { count: d.counts.series })}`} />
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader
                  icon={Clapperboard}
                  accent={accent}
                  title={t('svc.server.libraries')}
                  subtitle={scan.error ? <span className="text-bad">{(scan.error as Error).message}</span> : t('svc.server.libraryCount', { count: d.libraries.length })}
                  action={
                    admin ? (
                      <Button size="sm" disabled={scan.isPending} onClick={() => scan.mutate({})}>
                        {scan.isPending && !scan.variables?.library ? <LoaderCircle className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} {t('svc.server.scanAll')}
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
                          <FadeImage src={jfImage(l.image, 600)} alt="" className="aspect-video" imgClassName="transition-transform duration-700 group-hover:scale-105" fallback={<div className="size-full" style={{ background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 30%, transparent), var(--color-surface-3))` }} />} />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm font-semibold text-white"><Icon className="size-3.5" />{l.name}</div>
                              <div className="truncate text-[11px] text-white/60">{l.locations[0]}</div>
                            </div>
                            <span className="text-lg font-semibold text-white tabular">{l.itemCount?.toLocaleString(getLocale()) ?? '—'}</span>
                          </div>
                          {l.refreshing && <div className="absolute top-2 left-2"><Pill tone="brand">{t('widgets.library.scanning', { pct: Math.round(l.refreshProgress ?? 0) })}</Pill></div>}
                          {admin && (
                            <div className="absolute top-1.5 right-1.5 rounded-lg bg-black/40 text-white backdrop-blur">
                              <Menu
                                label={t('ui.actionsFor', { title: l.name })}
                                busy={scan.isPending && scan.variables?.library === l.id}
                                items={[
                                  { label: t('svc.server.scan'), icon: ScanSearch, onSelect: () => scan.mutate({ library: l.id, name: l.name }) },
                                  {
                                    label: t('svc.server.refresh'),
                                    icon: RefreshCw,
                                    hint: t('svc.server.refreshHint'),
                                    onSelect: () => confirm(t('svc.server.confirmRefresh', { name: l.name })) && scan.mutate({ library: l.id, name: l.name, full: true }),
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
                <CardHeader icon={MonitorPlay} title={t('svc.server.server')} subtitle={d.server.name} />
                <CardBody>
                  <div className="divide-y divide-line">
                    <KV k={t('svc.server.version')} v={d.server.version} />
                    <KV k={t('svc.server.os')} v={d.server.os ?? '—'} />
                    <KV k={t('svc.server.arch')} v={d.server.architecture ?? '—'} />
                    <KV k={t('svc.server.update')} v={d.server.hasUpdateAvailable ? <Pill tone="brand">{t('media.yes')}</Pill> : t('svc.server.no')} />
                    <KV k={t('svc.server.restart')} v={d.server.hasPendingRestart ? <Pill tone="warn">{t('media.yes')}</Pill> : t('svc.server.no')} />
                    <KV k={t('svc.server.episodes')} v={d.counts.episodes.toLocaleString(getLocale())} />
                    <KV k={t('svc.server.songs')} v={d.counts.songs.toLocaleString(getLocale())} />
                    <KV k={t('svc.music.books')} v={d.counts.books.toLocaleString(getLocale())} />
                    <KV k={t('svc.server.collections')} v={d.counts.collections.toLocaleString(getLocale())} />
                  </div>
                </CardBody>
              </Card>
            </div>

            <RecentlyAddedWidget server={server} serverType={type} />

            <div className="grid gap-5 xl:grid-cols-3">
              {isMain && <div className="xl:col-span-2"><PlaysWidget /></div>}
              <Card className={!isMain ? 'xl:col-span-3' : undefined}>
                <CardHeader icon={Users} title={t('widgets.library.users')} subtitle={t('svc.server.recentFirst')} />
                <CardBody>
                  <ul className="space-y-1">
                    {d.users.list.slice(0, 8).map((u) => (
                      <li key={u.id} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.03]">
                        <Avatar src={jfUserImage(u.id, u.imageTag, 96, extra)} name={u.name} size={30} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{u.name}</div>
                          <div className="text-[11px] text-ink-4">{u.lastActivity ? t('svc.server.activeWhen', { when: relative(u.lastActivity) }) : t('svc.server.never')}</div>
                        </div>
                        {u.isAdmin && <Pill>{t('svc.server.admin')}</Pill>}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </div>
            {admin && type === 'jellyfin' && <JellyfinTasks />}
            <ActivityWidget limit={15} server={server} serverType={type} />
          </div>
        )}
      </QueryState>
    </>
  );
}


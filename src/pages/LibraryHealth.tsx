import { useState } from 'react';
import { ArrowUpCircle, Check, FileQuestion, FolderX, LoaderCircle, Search, Stethoscope, TvMinimalPlay } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLibraryHealth, useMainServer, useSearchUpgrades } from '@/hooks/queries';
import { relative } from '@/lib/format';
import type { LibraryHealth, LibraryHealthItem } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { ReclaimCard } from '@/components/widgets/ReclaimCard';
import { WatchedByEveryoneCard } from '@/components/widgets/WatchedByEveryoneCard';
import { DevicePlaybackCard } from '@/components/widgets/DevicePlaybackCard';
import { useT } from '@/i18n';

function ItemList({ items, total, empty }: { items: LibraryHealthItem[]; total: number; empty: string }) {
  const t = useT();
  if (!items.length) return <EmptyState icon={Check} title={t('library.health.allGood')} description={empty} />;
  return (
    <>
      <ul className="max-h-[480px] divide-y divide-line overflow-y-auto">
        {items.map((i, n) => (
          <li key={`${i.instance ?? ''}-${i.title}-${n}`} className="flex items-center gap-3 py-2">
            {i.poster !== undefined || i.instance ? (
              <FadeImage src={i.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">
                {i.title} {i.year ? <span className="font-normal text-ink-4">({i.year})</span> : null}
              </div>
              <div className="truncate text-[11px] text-ink-3">{i.detail}</div>
            </div>
            {i.instanceName && <Pill className="shrink-0">{i.instanceName}</Pill>}
          </li>
        ))}
      </ul>
      {total > items.length && <p className="mt-2 text-[11px] text-ink-4">{t('library.health.showing', { count: items.length, total })}</p>}
    </>
  );
}

function Upgrades({ d }: { d: LibraryHealth }) {
  const { user } = useAuth();
  const search = useSearchUpgrades();
  const t = useT();
  const [started, setStarted] = useState<Set<string>>(new Set());
  return (
    <Card>
      <CardHeader icon={ArrowUpCircle} accent="var(--color-brand)" title={t('library.health.upgrades')} subtitle={t('library.health.upgradesHint')} />
      <CardBody>
        <ul className="divide-y divide-line">
          {d.upgrades.map((u) => (
            <li key={u.instance} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{u.kind === 'sonarr' ? 'Sonarr' : 'Radarr'}{u.instanceName ? ` · ${u.instanceName}` : ''}</div>
                <div className="text-[11px] text-ink-3">
                  {u.count ? t(u.kind === 'sonarr' ? 'library.health.episodesUpgrade' : 'library.health.moviesUpgrade', { count: u.count }) : t('library.health.cutoffMet')}
                </div>
              </div>
              {user?.isAdmin && u.count > 0 && (
                <Button
                  size="sm"
                  disabled={search.isPending || started.has(u.instance)}
                  onClick={() => {
                    if (!confirm(t('library.health.confirmUpgrade', { count: u.count }))) return;
                    search.mutate({ kind: u.kind, instance: u.instance }, { onSuccess: () => setStarted((s) => new Set(s).add(u.instance)) });
                  }}
                >
                  {search.isPending && search.variables?.instance === u.instance ? <LoaderCircle className="size-3.5 animate-spin" /> : started.has(u.instance) ? <Check className="size-3.5" /> : <Search className="size-3.5" />}
                  {started.has(u.instance) ? t('widgets.missing.started') : t('library.health.searchUpgrades')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {search.error && <p className="mt-2 text-xs text-bad">{(search.error as Error).message}</p>}
      </CardBody>
    </Card>
  );
}

export default function LibraryHealthPage() {
  const q = useLibraryHealth();
  const { user } = useAuth();
  const t = useT();
  const { name: mainName, type, other } = useMainServer();
  // Compared with every media server once there's more than one (the server says "your media servers").
  const several = q.data?.server === 'your media servers';
  const name = several ? t('library.health.yourServers') : (q.data?.server ?? mainName);
  return (
    <>
      <PageHeader
        eyebrow={t('dashboard.widgets.library')}
        title={t('nav.libraryHealth')}
        description={
          q.data ? `${t('library.health.crossChecks', { server: name })} · ${t('dashboard.checked', { when: relative(q.data.checkedAt) })}` : t('library.health.crossChecks', { server: name })
        }
      />
      <QueryState query={q} skeleton={<PageLoader label={t('library.health.loading')} hint={t('library.health.loadingHint', { server: name })} />}>
        {(d) =>
          !d.hasSonarr && !d.hasRadarr ? (
            <Card><EmptyState icon={Stethoscope} title={t('library.health.connect')} description={t('library.health.connectHint', { server: name })} /></Card>
          ) : (
            <div className="space-y-5">
              <div className="grid items-start gap-5 xl:grid-cols-2">
                {d.incomplete && (
                  <Card>
                    <CardHeader icon={TvMinimalPlay} accent="var(--color-sonarr)" title={t('library.health.incomplete')} subtitle={t('library.health.incompleteHint', { count: d.incomplete.total })} />
                    <CardBody><ItemList {...d.incomplete} empty={t('library.health.incompleteNone')} /></CardBody>
                  </Card>
                )}
                <Upgrades d={d} />
              </div>
              {d.unreachable && d.unreachable.length > 0 && (
                <p className="text-xs text-warn">{t('library.health.unreachable', { list: d.unreachable.join(', ') })}</p>
              )}
              {d.hasJellyfin ? (
                <div className="grid items-start gap-5 xl:grid-cols-2">
                  {d.notInJellyfin && (
                    <Card>
                      <CardHeader icon={FolderX} accent="var(--color-warn)" title={several ? t('library.health.notOnAny') : t('library.health.notIn', { server: name })} subtitle={t('library.health.notInHint')} />
                      <CardBody><ItemList {...d.notInJellyfin} empty={several ? t('library.health.notOnAnyNone') : t('library.health.notInNone', { server: name })} /></CardBody>
                    </Card>
                  )}
                  {d.unmanaged && (
                    <Card>
                      <CardHeader icon={FileQuestion} accent={`var(--color-${type})`} title={several ? t('library.health.unmanagedAll') : t('library.health.unmanaged', { server: name })} subtitle={t('library.health.unmanagedHint')} />
                      <CardBody><ItemList {...d.unmanaged} empty={several ? t('library.health.unmanagedAllNone') : t('library.health.unmanagedNone', { server: name })} /></CardBody>
                    </Card>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink-4">{several ? t('library.health.skippedAll') : t('library.health.skipped', { server: name })}</p>
              )}
              {d.hasJellyfin && <ReclaimCard />}
              {d.hasJellyfin && !other && <WatchedByEveryoneCard />}
            </div>
          )
        }
      </QueryState>
      {/* Device playback learning reads Jellyfin's media details. */}
      {user?.isAdmin && !other && <div className="mt-5"><DevicePlaybackCard /></div>}
    </>
  );
}

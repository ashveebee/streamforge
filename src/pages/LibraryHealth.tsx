import { useState } from 'react';
import { ArrowUpCircle, Check, FileQuestion, FolderX, LoaderCircle, Search, Stethoscope, TvMinimalPlay } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLibraryHealth, useSearchUpgrades } from '@/hooks/queries';
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
import { DevicePlaybackCard } from '@/components/widgets/DevicePlaybackCard';

function ItemList({ items, total, empty }: { items: LibraryHealthItem[]; total: number; empty: string }) {
  if (!items.length) return <EmptyState icon={Check} title="All good" description={empty} />;
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
      {total > items.length && <p className="mt-2 text-[11px] text-ink-4">Showing {items.length} of {total}.</p>}
    </>
  );
}

function Upgrades({ d }: { d: LibraryHealth }) {
  const { user } = useAuth();
  const search = useSearchUpgrades();
  const [started, setStarted] = useState<Set<string>>(new Set());
  return (
    <Card>
      <CardHeader icon={ArrowUpCircle} accent="var(--color-brand)" title="Upgrades available" subtitle="Files below the quality profile’s cutoff" />
      <CardBody>
        <ul className="divide-y divide-line">
          {d.upgrades.map((u) => (
            <li key={u.instance} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{u.kind === 'sonarr' ? 'Sonarr' : 'Radarr'}{u.instanceName ? ` · ${u.instanceName}` : ''}</div>
                <div className="text-[11px] text-ink-3">
                  {u.count ? `${u.count} ${u.kind === 'sonarr' ? 'episode' : 'movie'}${u.count === 1 ? '' : 's'} could be upgraded` : 'Everything meets its cutoff'}
                </div>
              </div>
              {user?.isAdmin && u.count > 0 && (
                <Button
                  size="sm"
                  disabled={search.isPending || started.has(u.instance)}
                  onClick={() => {
                    if (!confirm(`Search for better releases of ${u.count} item${u.count === 1 ? '' : 's'}? Large searches can take a while.`)) return;
                    search.mutate({ kind: u.kind, instance: u.instance }, { onSuccess: () => setStarted((s) => new Set(s).add(u.instance)) });
                  }}
                >
                  {search.isPending && search.variables?.instance === u.instance ? <LoaderCircle className="size-3.5 animate-spin" /> : started.has(u.instance) ? <Check className="size-3.5" /> : <Search className="size-3.5" />}
                  {started.has(u.instance) ? 'Search started' : 'Search for upgrades'}
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
  return (
    <>
      <PageHeader
        eyebrow="Library"
        title="Library health"
        description={
          q.data ? `Cross-checks Sonarr, Radarr and Jellyfin · checked ${relative(q.data.checkedAt)}` : 'Cross-checks Sonarr, Radarr and Jellyfin'
        }
      />
      <QueryState query={q} skeleton={<PageLoader label="Checking library health" hint="Cross-checking Sonarr, Radarr and Jellyfin…" />}>
        {(d) =>
          !d.hasSonarr && !d.hasRadarr ? (
            <Card><EmptyState icon={Stethoscope} title="Connect Sonarr or Radarr" description="Library health compares what Sonarr and Radarr manage with what Jellyfin has." /></Card>
          ) : (
            <div className="space-y-5">
              <div className="grid items-start gap-5 xl:grid-cols-2">
                {d.incomplete && (
                  <Card>
                    <CardHeader icon={TvMinimalPlay} accent="var(--color-sonarr)" title="Incomplete series" subtitle={`${d.incomplete.total} monitored series with aired episodes missing`} />
                    <CardBody><ItemList {...d.incomplete} empty="Every monitored series has all its aired episodes." /></CardBody>
                  </Card>
                )}
                <Upgrades d={d} />
              </div>
              {d.hasJellyfin ? (
                <div className="grid items-start gap-5 xl:grid-cols-2">
                  {d.notInJellyfin && (
                    <Card>
                      <CardHeader icon={FolderX} accent="var(--color-warn)" title="Downloaded but not in Jellyfin" subtitle="Check library paths, or run a library scan" />
                      <CardBody><ItemList {...d.notInJellyfin} empty="Everything Sonarr and Radarr have downloaded shows up in Jellyfin." /></CardBody>
                    </Card>
                  )}
                  {d.unmanaged && (
                    <Card>
                      <CardHeader icon={FileQuestion} accent="var(--color-jellyfin)" title="In Jellyfin but not managed" subtitle="Won’t get upgrades or new episodes" />
                      <CardBody><ItemList {...d.unmanaged} empty="Everything in Jellyfin is managed by Sonarr or Radarr." /></CardBody>
                    </Card>
                  )}
                </div>
              ) : (
                <p className="text-xs text-ink-4">Jellyfin couldn’t be reached, so the Jellyfin cross-checks are skipped.</p>
              )}
              {d.hasJellyfin && <ReclaimCard />}
            </div>
          )
        }
      </QueryState>
      {user?.isAdmin && <div className="mt-5"><DevicePlaybackCard /></div>}
    </>
  );
}

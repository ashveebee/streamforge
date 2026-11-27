import { useState } from 'react';
import { Captions, Check, Film, History, LoaderCircle, Search, Tv } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBazarr, useBazarrSearch } from '@/hooks/useServices';
import { relative } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { t } from '@/i18n';

function SearchButton({ label, onClick, busy, done }: { label: string; onClick: () => void; busy: boolean; done: boolean }) {
  return (
    <Button size="sm" variant="ghost" disabled={busy || done} onClick={onClick} aria-label={label}>
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : done ? <Check className="size-3.5 text-ok" /> : <Search className="size-3.5" />}
      {done ? t('widgets.missing.searching') : t('nav.search')}
    </Button>
  );
}

export default function BazarrPage() {
  const q = useBazarr();
  const { user } = useAuth();
  const search = useBazarrSearch();
  const [done, setDone] = useState<Set<string>>(new Set());
  const run = (key: string, body: Parameters<typeof search.mutate>[0]) => search.mutate(body, { onSuccess: () => setDone((s) => new Set(s).add(key)) });
  const busy = (key: string) => search.isPending && done.has(key) === false && JSON.stringify(search.variables) === key;

  return (
    <>
      <ServiceHeader id="bazarr" />
      <QueryState query={q} skeleton={<PageLoader label={t('svc.bazarr.loading')} hint={t('svc.bazarr.loadingHint')} />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('svc.bazarr.episodes')} value={d.counts.episodes} icon={Tv} accent="var(--color-sonarr)" />
              <StatTile label={t('svc.bazarr.movies')} value={d.counts.movies} icon={Film} accent="var(--color-radarr)" />
              <StatTile label={t('svc.bazarr.throttled')} value={d.counts.providerIssues} icon={Captions} accent="var(--color-warn)" />
              <StatTile label={t('svc.bazarr.health')} value={d.counts.healthIssues} icon={Captions} accent="var(--color-bad)" />
            </div>
            {search.error && <p className="text-xs text-bad" role="alert">{(search.error as Error).message}</p>}
            <div className="grid items-start gap-5 xl:grid-cols-2">
              {(['episodes', 'movies'] as const).map((kind) => {
                const list = kind === 'episodes' ? d.episodes : d.movies;
                const allKey = JSON.stringify({ all: kind });
                return (
                  <Card key={kind}>
                    <CardHeader
                      icon={kind === 'episodes' ? Tv : Film}
                      accent={kind === 'episodes' ? 'var(--color-sonarr)' : 'var(--color-radarr)'}
                      title={kind === 'episodes' ? t('svc.bazarr.episodesTitle') : t('widgets.library.movies')}
                      subtitle={t('svc.bazarr.missing', { count: list.total })}
                      action={
                        user?.isAdmin && list.total > 0 ? (
                          <Button size="sm" disabled={search.isPending || done.has(allKey)} onClick={() => run(allKey, { all: kind })}>
                            {done.has(allKey) ? <Check className="size-3.5" /> : <Search className="size-3.5" />} {done.has(allKey) ? t('widgets.missing.started') : t('widgets.missing.searchAll')}
                          </Button>
                        ) : undefined
                      }
                    />
                    <CardBody>
                      {!list.items.length ? (
                        <EmptyState icon={Check} title={t('svc.bazarr.all')} description={t('svc.bazarr.allHint')} />
                      ) : (
                        <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                          {list.items.map((i) => {
                            const body = 'seriesId' in i ? { seriesId: i.seriesId } : { movieId: i.movieId };
                            const key = JSON.stringify(body);
                            return (
                              <li key={'episodeId' in i ? i.episodeId : i.movieId} className="flex items-center gap-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] font-medium">{i.title}</div>
                                  {'subtitle' in i && i.subtitle && <div className="truncate text-[11px] text-ink-3">{i.subtitle}</div>}
                                  <div className="mt-1 flex flex-wrap gap-1">{i.missing.map((m) => <Pill key={m}>{m}</Pill>)}</div>
                                </div>
                                {user?.isAdmin && <SearchButton label={t('svc.bazarr.searchFor', { title: i.title })} busy={busy(key)} done={done.has(key)} onClick={() => run(key, body)} />}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
            <Card>
              <CardHeader icon={History} accent="var(--color-bazarr)" title={t('widgets.cleanup.recent')} subtitle={t('svc.bazarr.activityHint')} />
              <CardBody>
                {!d.history.length ? (
                  <EmptyState icon={History} title={t('svc.bazarr.noActivity')} />
                ) : (
                  <ul className="divide-y divide-line">
                    {d.history.map((h, n) => (
                      <li key={n} className="flex items-center gap-3 py-2">
                        {h.kind === 'episode' ? <Tv className="size-4 shrink-0 text-sonarr" /> : <Film className="size-4 shrink-0 text-radarr" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{h.title}{h.subtitle ? <span className="font-normal text-ink-3"> · {h.subtitle}</span> : null}</div>
                          <div className="truncate text-[11px] text-ink-4">{[h.description, h.language, h.provider].filter(Boolean).join(' · ')}</div>
                        </div>
                        {h.at && <span className="shrink-0 text-[11px] text-ink-4">{relative(h.at)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}

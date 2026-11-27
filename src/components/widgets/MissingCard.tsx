import { useState } from 'react';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Search, SearchX } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useMissing, useSearch } from '@/hooks/queries';
import { dayLabel } from '@/lib/format';
import type { ArrKind } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { EmptyState, SkeletonRows } from '@/components/ui/States';
import { TitleLink, arrTitlePath } from '@/components/ui/TitleLink';
import { t } from '@/i18n';

/** Monitored items that aren't downloaded yet, with search buttons. */
export function MissingCard({ kind, instance }: { kind: ArrKind | 'lidarr' | 'readarr'; instance?: string }) {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const q = useMissing(kind, instance, page);
  const search = useSearch(kind);
  const [searched, setSearched] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const d = q.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const noun = ({ sonarr: 'episode', radarr: 'movie', lidarr: 'album', readarr: 'book' } as const)[kind];

  const one = (id: number) =>
    search.mutate({ instance, ids: [id] }, { onSuccess: () => setSearched((s) => new Set(s).add(id)) });
  const everything = () => {
    if (!d || !confirm(t(`widgets.missing.confirm.${noun}`, { count: d.total }))) return;
    search.mutate({ instance, ids: [] }, { onSuccess: () => setAll(true) });
  };

  return (
    <Card>
      <CardHeader
        icon={SearchX}
        accent="var(--color-bad)"
        title={t('widgets.missing.title')}
        subtitle={d ? t(`widgets.missing.count.${noun}`, { count: d.total }) : t('widgets.missing.about')}
        action={
          user?.isAdmin && d && d.total > 0 ? (
            <Button size="sm" disabled={search.isPending || all} onClick={everything}>
              {all ? <Check className="size-3.5" /> : <Search className="size-3.5" />}
              {all ? t('widgets.missing.started') : t('widgets.missing.searchAll')}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {search.error && <p className="mb-2 text-xs text-bad" role="alert">{(search.error as Error).message}</p>}
        {!d ? (
          <SkeletonRows rows={4} />
        ) : !d.items.length ? (
          <EmptyState icon={Check} title={t('widgets.missing.none')} description={t(`widgets.missing.noneHint.${noun}`)} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {d.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <FadeImage src={i.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
                  <div className="min-w-0 flex-1">
                    <TitleLink to={kind === 'sonarr' || kind === 'radarr' ? arrTitlePath(kind, i.tmdbId) : undefined} className="block truncate text-[13px] font-medium">{i.title}</TitleLink>
                    <div className="truncate text-[11px] text-ink-3">{[i.subtitle, i.date ? dayLabel(i.date) : undefined].filter(Boolean).join(' · ')}</div>
                  </div>
                  {user?.isAdmin && (
                    <Button size="sm" variant="ghost" disabled={search.isPending || searched.has(i.id)} onClick={() => one(i.id)} aria-label={t('widgets.missing.searchFor', { title: `${i.title} ${i.subtitle ?? ''}`.trim() })}>
                      {search.isPending && search.variables?.ids[0] === i.id ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : searched.has(i.id) ? (
                        <Check className="size-3.5 text-ok" />
                      ) : (
                        <Search className="size-3.5" />
                      )}
                      {searched.has(i.id) ? t('widgets.missing.searching') : t('nav.search')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-3">
                <span>{t('widgets.page', { page, pages })}</span>
                <Button size="icon" variant="ghost" className="size-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label={t('widgets.prev')}><ChevronLeft className="size-4" /></Button>
                <Button size="icon" variant="ghost" className="size-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label={t('widgets.next')}><ChevronRight className="size-4" /></Button>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

import { useState } from 'react';

import { BookmarkCheck, Check, CircleAlert, EyeOff, LoaderCircle, Recycle, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useReclaim, useReclaimAction, type ReclaimItem } from '@/hooks/useServices';
import { bytes, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FadeImage } from '../ui/Image';
import { Menu } from '../ui/Menu';
import { Pill } from '../ui/Status';
import { EmptyState, ErrorState, SkeletonRows } from '../ui/States';
import { TitleLink, arrTitlePath } from '@/components/ui/TitleLink';
import { t } from '@/i18n';

const PERIODS = [
  { days: 90, get label() { return t('widgets.reclaim.months', { count: 3 }); } },
  { days: 180, get label() { return t('widgets.reclaim.months', { count: 6 }); } },
  { days: 365, get label() { return t('widgets.reclaim.years', { count: 1 }); } },
  { days: 730, get label() { return t('widgets.reclaim.years', { count: 2 }); } },
];

function Row({ i }: { i: ReclaimItem }) {
  const { user } = useAuth();
  const act = useReclaimAction();
  const run = (action: 'delete' | 'unmonitor' | 'keep') => act.mutate({ kind: i.kind, instance: i.instance, id: i.arrId, action });
  return (
    <li className={cn('flex items-center gap-3 py-2', act.isSuccess && 'opacity-40')}>
      <FadeImage src={i.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
      <div className="min-w-0 flex-1">
        <TitleLink to={arrTitlePath(i.kind === 'series' ? 'sonarr' : 'radarr', i.tmdbId)} className="block truncate text-[13px] font-medium">{i.title} {i.year ? <span className="font-normal text-ink-4">({i.year})</span> : null}</TitleLink>
        <div className="truncate text-[11px] text-ink-3">
          {[i.kind === 'series' ? (i.ended ? t('widgets.reclaim.ended') : t('me.series')) : t('me.movie'), i.instanceName, i.lastWatched ? t('widgets.reclaim.lastWatched', { when: relative(i.lastWatched) }) : t('widgets.reclaim.never'), i.added ? t('widgets.reclaim.added', { when: relative(i.added) }) : undefined].filter(Boolean).join(' · ')}
        </div>
      </div>
      <span className="shrink-0 text-[13px] font-semibold tabular">{bytes(i.size)}</span>
      {user?.isAdmin && (
        <div className="shrink-0" title={act.error ? (act.error as Error).message : undefined}>
          {act.isPending ? (
            <LoaderCircle className="m-1.5 size-4 animate-spin text-ink-4" />
          ) : act.isSuccess ? (
            <Check className="m-1.5 size-4 text-ok" />
          ) : (
            <Menu
              label={t('ui.actionsFor', { title: i.title })}
              trigger={act.isError ? <CircleAlert className="size-4 text-bad" /> : undefined}
              items={[
                { label: t('widgets.reclaim.keep'), icon: BookmarkCheck, hint: t('widgets.reclaim.keepHint'), onSelect: () => run('keep') },
                { label: t('widgets.reclaim.unmonitor'), icon: EyeOff, hint: t('widgets.reclaim.unmonitorHint'), onSelect: () => run('unmonitor') },
                {
                  label: t('widgets.reclaim.delete'),
                  icon: Trash2,
                  danger: true,
                  hint: t('widgets.reclaim.frees', { size: bytes(i.size) }),
                  onSelect: () => confirm(t('widgets.reclaim.confirmDelete', { title: i.title, size: bytes(i.size) })) && run('delete'),
                },
              ]}
            />
          )}
        </div>
      )}
    </li>
  );
}

/** Large movies and series nobody has watched in a while. */
export function ReclaimCard() {
  const [days, setDays] = useState(365);
  const q = useReclaim(days);
  return (
    <Card>
      <CardHeader
        icon={Recycle}
        accent="var(--color-ok)"
        title={t('widgets.reclaim.title')}
        subtitle={q.data ? `${t('widgets.reclaim.unwatched', { count: q.data.total, period: PERIODS.find((p) => p.days === days)?.label })} · ${t('widgets.reclaim.couldFree', { size: bytes(q.data.reclaimable) })}` : t('widgets.reclaim.about')}
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label={t('widgets.reclaim.for')}>
          <span className="mr-1 text-xs text-ink-4">{t('widgets.reclaim.for')}</span>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              role="tab"
              aria-selected={days === p.days}
              onClick={() => setDays(p.days)}
              className={cn('rounded-lg border px-2.5 py-1 text-xs transition', days === p.days ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
            >
              {p.label}
            </button>
          ))}
          {q.isFetching && <LoaderCircle className="ml-1 size-3.5 animate-spin text-ink-4" />}
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <SkeletonRows rows={5} />
        ) : !q.data.items.length ? (
          <EmptyState icon={Check} title={t('widgets.reclaim.none')} description={t('widgets.reclaim.noneHint')} />
        ) : (
          <>
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">{q.data.items.map((i) => <Row key={i.key} i={i} />)}</ul>
            <p className="mt-2 text-[11px] text-ink-4">
              {t('widgets.reclaim.basis')}{q.data.kept ? ` ${t('widgets.reclaim.kept', { count: q.data.kept })}` : ''}
              {q.data.total > q.data.items.length && <> {t('widgets.reclaim.largest', { count: q.data.items.length })}</>}
            </p>
            {q.data.items.length > 0 && <Pill className="mt-2">{t('widgets.reclaim.checked', { when: relative(q.data.checkedAt) })}</Pill>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

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

const PERIODS = [
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
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
          {[i.kind === 'series' ? (i.ended ? 'Ended series' : 'Series') : 'Movie', i.instanceName, i.lastWatched ? `last watched ${relative(i.lastWatched)}` : 'never watched', i.added ? `added ${relative(i.added)}` : undefined].filter(Boolean).join(' · ')}
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
              label={`Actions for ${i.title}`}
              trigger={act.isError ? <CircleAlert className="size-4 text-bad" /> : undefined}
              items={[
                { label: 'Keep', icon: BookmarkCheck, hint: 'Never suggest this again', onSelect: () => run('keep') },
                { label: 'Stop monitoring', icon: EyeOff, hint: 'Keep the files, stop upgrades and new episodes', onSelect: () => run('unmonitor') },
                {
                  label: 'Delete files & remove',
                  icon: Trash2,
                  danger: true,
                  hint: `Frees ${bytes(i.size)}`,
                  onSelect: () => confirm(`Delete “${i.title}” and its files (${bytes(i.size)}) from disk? This can’t be undone.`) && run('delete'),
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
        title="Cleanup suggestions"
        subtitle={q.data ? `${q.data.total} title${q.data.total === 1 ? '' : 's'} nobody has watched in ${PERIODS.find((p) => p.days === days)?.label} · ${bytes(q.data.reclaimable)} could be freed` : 'Big titles nobody watches'}
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Unwatched for">
          <span className="mr-1 text-xs text-ink-4">Unwatched for</span>
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
          <EmptyState icon={Check} title="Nothing to clean up" description="Everything has been watched recently or was added recently." />
        ) : (
          <>
            <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">{q.data.items.map((i) => <Row key={i.key} i={i} />)}</ul>
            <p className="mt-2 text-[11px] text-ink-4">
              Based on every Jellyfin user’s play history. Titles added in this period are skipped.{q.data.kept ? ` ${q.data.kept} kept title${q.data.kept === 1 ? '' : 's'} hidden.` : ''}
              {q.data.total > q.data.items.length && <> Showing the largest {q.data.items.length}.</>}
            </p>
            {q.data.items.length > 0 && <Pill className="mt-2">Checked {relative(q.data.checkedAt)}</Pill>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

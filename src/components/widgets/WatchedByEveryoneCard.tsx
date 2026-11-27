import { useMemo, useState } from 'react';
import { BookmarkCheck, Check, EyeOff, LoaderCircle, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCountUser, useReclaimAction, useWatchedByEveryone, type ReclaimItem } from '@/hooks/useServices';
import { api } from '@/lib/api';
import { bytes, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FadeImage } from '../ui/Image';
import { Pill } from '../ui/Status';
import { EmptyState, ErrorState, SkeletonRows } from '../ui/States';
import { TitleLink, arrTitlePath } from '@/components/ui/TitleLink';
import { t } from '@/i18n';

type Outcome = 'done' | 'failed';

/** Movies and series every counted user has finished, biggest first, with bulk removal. */
export function WatchedByEveryoneCard() {
  const { user } = useAuth();
  const admin = !!user?.isAdmin;
  const q = useWatchedByEveryone();
  const count = useCountUser();
  const keep = useReclaimAction();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});
  const d = q.data;
  const items = d?.items ?? [];
  const chosen = useMemo(() => items.filter((i) => picked.has(i.key) && !outcome[i.key]), [items, picked, outcome]);
  const chosenSize = chosen.reduce((n, i) => n + i.size, 0);
  const counted = d?.users.filter((u) => u.counted) ?? [];

  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const run = async (action: 'delete' | 'unmonitor') => {
    if (!chosen.length) return;
    if (action === 'delete' && !confirm(t('widgets.everyone.confirmDelete', { count: chosen.length, size: bytes(chosenSize) }))) return;
    setBusy(true);
    for (const i of chosen) {
      try {
        await api('/library/reclaim', { method: 'POST', body: { kind: i.kind, instance: i.instance, id: i.arrId, action } });
        setOutcome((o) => ({ ...o, [i.key]: 'done' }));
      } catch {
        setOutcome((o) => ({ ...o, [i.key]: 'failed' }));
      }
    }
    setBusy(false);
    setPicked(new Set());
    void qc.invalidateQueries({ queryKey: ['library', 'reclaim'] });
  };

  return (
    <Card>
      <CardHeader
        icon={Users}
        accent="var(--color-brand)"
        title={t('widgets.everyone.title')}
        subtitle={d?.supported ? `${t('widgets.everyone.titles', { count: d.total })} · ${t('widgets.everyone.users', { count: counted.length })} · ${t('widgets.reclaim.couldFree', { size: bytes(d.reclaimable) })}` : t('widgets.everyone.about')}
      />
      <CardBody>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !d ? (
          <SkeletonRows rows={5} />
        ) : !d.supported ? (
          <EmptyState icon={Users} title={t('widgets.everyone.needsJellyfin')} description={t('widgets.everyone.needsJellyfinHint')} />
        ) : (
          <>
            <div className="mb-3">
              <div className="mb-1.5 text-xs text-ink-4">{t('widgets.everyone.who')} {admin && <span className="text-ink-4">· {t('widgets.everyone.whoHint')}</span>}</div>
              <div className="flex flex-wrap gap-1.5">
                {d.users.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    disabled={!admin || count.isPending}
                    aria-pressed={u.counted}
                    onClick={() => count.mutate({ id: u.id, counted: !u.counted })}
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition disabled:cursor-default',
                      u.counted ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 line-through hover:text-ink-2',
                    )}
                    title={`${t('widgets.everyone.watched', { count: u.watched })}${u.counted ? '' : ` · ${t('widgets.everyone.notCounted')}`}`}
                  >
                    {u.counted && <Check className="size-3" />}
                    {u.name}
                    <span className="text-ink-4">{u.watched}</span>
                  </button>
                ))}
              </div>
            </div>
            {admin && items.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                <span className="text-xs text-ink-2">
                  {chosen.length ? <><b>{t('widgets.everyone.selected', { count: chosen.length })}</b> · {bytes(chosenSize)}</> : t('widgets.everyone.selectHint')}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(items.filter((i) => !outcome[i.key]).map((i) => i.key)))}>{t('widgets.everyone.selectAll')}</Button>
                {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{t('widgets.everyone.clear')}</Button>}
                <span className="flex-1" />
                {busy && <LoaderCircle className="size-4 animate-spin text-ink-4" />}
                <Button size="sm" disabled={!chosen.length || busy} onClick={() => void run('unmonitor')}><EyeOff className="size-3.5" /> {t('widgets.reclaim.unmonitor')}</Button>
                <Button size="sm" className="border-bad/40 text-bad hover:text-bad" disabled={!chosen.length || busy} onClick={() => void run('delete')}><Trash2 className="size-3.5" /> {t('widgets.everyone.delete')} {chosen.length ? bytes(chosenSize) : ''}</Button>
              </div>
            )}
            {!items.length ? (
              <EmptyState icon={Check} title={t('widgets.everyone.none')} description={counted.length ? t('widgets.everyone.noneHint') : t('widgets.everyone.pickUser')} />
            ) : (
              <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                {items.map((i: ReclaimItem) => {
                  const o = outcome[i.key];
                  return (
                    <li key={i.key} className={cn('flex items-center gap-3 py-2', o === 'done' && 'opacity-40')}>
                      {admin && (
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-[var(--color-brand)]"
                          aria-label={t('widgets.everyone.select', { title: i.title })}
                          disabled={!!o || busy}
                          checked={picked.has(i.key)}
                          onChange={() => toggle(i.key)}
                        />
                      )}
                      <FadeImage src={i.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
                      <div className="min-w-0 flex-1">
                        <TitleLink to={arrTitlePath(i.kind === 'series' ? 'sonarr' : 'radarr', i.tmdbId)} className="block truncate text-[13px] font-medium">
                          {i.title} {i.year ? <span className="font-normal text-ink-4">({i.year})</span> : null}
                        </TitleLink>
                        <div className="truncate text-[11px] text-ink-3">
                          {[i.kind === 'series' ? (i.ended ? t('widgets.reclaim.ended') : t('me.series')) : t('me.movie'), i.instanceName, i.added ? t('widgets.reclaim.added', { when: relative(i.added) }) : undefined].filter(Boolean).join(' · ')}
                          {o === 'failed' && <span className="text-bad"> · {t('widgets.everyone.couldntRemove')}</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-[13px] font-semibold tabular">{bytes(i.size)}</span>
                      {admin && !o && (
                        <button type="button" title={t('widgets.everyone.keepHint')} aria-label={t('widgets.everyone.keep', { title: i.title })} onClick={() => keep.mutate({ kind: i.kind, instance: i.instance, id: i.arrId, action: 'keep' })} className="rounded-md p-1.5 text-ink-4 hover:bg-white/[0.06] hover:text-ink-2">
                          <BookmarkCheck className="size-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-ink-4">
              {t('widgets.everyone.note')}
              {d.kept ? ` ${t('widgets.reclaim.kept', { count: d.kept })}` : ''}
            </p>
            <Pill className="mt-2">{t('widgets.reclaim.checked', { when: relative(d.checkedAt) })}</Pill>
          </>
        )}
      </CardBody>
    </Card>
  );
}

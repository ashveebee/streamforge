import { useState } from 'react';
import { CircleAlert, CircleCheck, ListChecks, LoaderCircle, Play, Square } from 'lucide-react';
import { useJellyfinTasks, useTaskControl } from '@/hooks/useServices';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ProgressBar } from '../ui/Progress';
import { EmptyState, ErrorState, SkeletonRows } from '../ui/States';
import { t } from '@/i18n';

/** Jellyfin's scheduled tasks with run/stop buttons (admins only). */
export function JellyfinTasks() {
  const q = useJellyfinTasks(true);
  const ctl = useTaskControl();
  const [category, setCategory] = useState<string>('');
  const categories = [...new Set(q.data?.map((x) => x.category))];
  const tasks = q.data?.filter((x) => !category || x.category === category) ?? [];
  return (
    <Card>
      <CardHeader icon={ListChecks} accent="var(--color-jellyfin)" title={t('widgets.tasks.title')} subtitle={t('widgets.tasks.subtitle')} />
      <CardBody>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <SkeletonRows rows={6} />
        ) : !q.data.length ? (
          <EmptyState icon={ListChecks} title={t('widgets.tasks.none')} />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label={t('widgets.tasks.categories')}>
              {['', ...categories].map((c) => (
                <button
                  key={c || 'all'}
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => setCategory(c)}
                  className={cn('rounded-lg border px-2.5 py-1 text-xs transition', category === c ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
                >
                  {c || t('widgets.tasks.all')}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {tasks.map((task) => {
                const running = task.state !== 'Idle';
                const failed = task.last?.status && task.last.status !== 'Completed';
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium" title={task.description}>{task.name}</div>
                      <div className="flex items-center gap-1 truncate text-[11px] text-ink-4">
                        {task.last && (failed ? <CircleAlert className="size-3 text-bad" /> : <CircleCheck className="size-3 text-ok" />)}
                        {[
                          task.last?.endedAt
                            ? failed
                              ? `${task.last.status} ${relative(task.last.endedAt)}`
                              : t('widgets.tasks.ran', { when: relative(task.last.endedAt) })
                            : t('widgets.tasks.never'),
                          task.schedule.join(', ') || t('widgets.tasks.manual'),
                        ].join(' · ')}
                      </div>
                      {failed && task.last?.error && <div className="truncate text-[11px] text-bad" title={task.last.error}>{task.last.error}</div>}
                      {running && <ProgressBar value={task.progress ?? 0} height={3} glow={false} className="mt-1.5" />}
                    </div>
                    <Button
                      size="sm"
                      variant={running ? 'outline' : 'ghost'}
                      disabled={ctl.isPending || task.state === 'Cancelling'}
                      onClick={() => ctl.mutate({ id: task.id, op: running ? 'stop' : 'start', name: task.name })}
                      aria-label={t(running ? 'widgets.tasks.stopTask' : 'widgets.tasks.runTask', { name: task.name })}
                    >
                      {ctl.isPending && ctl.variables?.id === task.id ? <LoaderCircle className="size-3.5 animate-spin" /> : running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                      {running ? `${Math.round((task.progress ?? 0) * 100)}% · ${t('widgets.controls.stop')}` : t('widgets.tasks.run')}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {ctl.error && <p className="mt-2 text-xs text-bad">{(ctl.error as Error).message}</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

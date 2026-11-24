import { useState } from 'react';
import { CircleAlert, CircleCheck, ListChecks, LoaderCircle, Play, Square } from 'lucide-react';
import { useJellyfinTasks, useTaskControl } from '@/hooks/useServices';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ProgressBar } from '../ui/Progress';
import { EmptyState, ErrorState, SkeletonRows } from '../ui/States';

/** Jellyfin's scheduled tasks with run/stop buttons (admins only). */
export function JellyfinTasks() {
  const q = useJellyfinTasks(true);
  const ctl = useTaskControl();
  const [category, setCategory] = useState<string>('');
  const categories = [...new Set(q.data?.map((t) => t.category))];
  const tasks = q.data?.filter((t) => !category || t.category === category) ?? [];
  return (
    <Card>
      <CardHeader icon={ListChecks} accent="var(--color-jellyfin)" title="Scheduled tasks" subtitle="Run maintenance jobs now instead of waiting for their schedule" />
      <CardBody>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data ? (
          <SkeletonRows rows={6} />
        ) : !q.data.length ? (
          <EmptyState icon={ListChecks} title="No tasks" />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Task categories">
              {['', ...categories].map((c) => (
                <button
                  key={c || 'all'}
                  role="tab"
                  aria-selected={category === c}
                  onClick={() => setCategory(c)}
                  className={cn('rounded-lg border px-2.5 py-1 text-xs transition', category === c ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
                >
                  {c || 'All'}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {tasks.map((t) => {
                const running = t.state !== 'Idle';
                const failed = t.last?.status && t.last.status !== 'Completed';
                return (
                  <li key={t.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium" title={t.description}>{t.name}</div>
                      <div className="flex items-center gap-1 truncate text-[11px] text-ink-4">
                        {t.last && (failed ? <CircleAlert className="size-3 text-bad" /> : <CircleCheck className="size-3 text-ok" />)}
                        {[t.last?.endedAt ? `${failed ? t.last.status : 'Ran'} ${relative(t.last.endedAt)}` : 'Never run', t.schedule.join(', ') || 'Manual only'].join(' · ')}
                      </div>
                      {failed && t.last?.error && <div className="truncate text-[11px] text-bad" title={t.last.error}>{t.last.error}</div>}
                      {running && <ProgressBar value={t.progress ?? 0} height={3} glow={false} className="mt-1.5" />}
                    </div>
                    <Button
                      size="sm"
                      variant={running ? 'outline' : 'ghost'}
                      disabled={ctl.isPending || t.state === 'Cancelling'}
                      onClick={() => ctl.mutate({ id: t.id, op: running ? 'stop' : 'start', name: t.name })}
                      aria-label={`${running ? 'Stop' : 'Run'} ${t.name}`}
                    >
                      {ctl.isPending && ctl.variables?.id === t.id ? <LoaderCircle className="size-3.5 animate-spin" /> : running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                      {running ? `${Math.round((t.progress ?? 0) * 100)}% · Stop` : 'Run'}
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

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, CircleAlert, Download, LoaderCircle, Pause, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useDownloads, useArrAll, useQueueAction, type QueueActionName } from '@/hooks/queries';
import { useAuth } from '@/hooks/useAuth';
import { bytes, speed } from '@/lib/format';
import type { QueueItem } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { AreaGradient, axisProps, ChartTooltip, gridProps, Legend, SERIES, timeLabel } from '../ui/Chart';
import { FadeImage } from '../ui/Image';
import { ProgressBar } from '../ui/Progress';
import { EmptyState, Skeleton } from '../ui/States';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { Menu, type MenuItem } from '../ui/Menu';

const CONFIRM: Partial<Record<QueueActionName, string>> = {
  remove: 'Remove this download and delete it from the download client?',
  blocklist: 'Remove and blocklist this release? It won’t be grabbed again.',
  'blocklist-search': 'Remove and blocklist this release, then search for another?',
};

/** Admin actions for one queue item. */
function QueueMenu({ item }: { item: QueueItem }) {
  const act = useQueueAction();
  const run = (action: QueueActionName) => {
    const msg = CONFIRM[action];
    if (msg && !confirm(`${msg}\n\n${item.releaseTitle}`)) return;
    act.mutate({ kind: item.source, instance: item.instance, id: item.id, action });
  };
  const delayed = item.status === 'delay' || item.status === 'pending';
  const items: MenuItem[] = [
    ...(delayed ? [{ label: 'Grab now', icon: Zap, hint: 'Skip the delay profile', onSelect: () => run('grab') }] : []),
    { label: 'Blocklist & search again', icon: RefreshCw, hint: 'Find a different release', onSelect: () => run('blocklist-search') },
    { label: 'Blocklist', icon: Ban, hint: 'Don’t grab this release again', onSelect: () => run('blocklist') },
    { label: 'Remove from queue only', icon: Trash2, hint: 'Leave it in the download client', onSelect: () => run('remove-keep') },
    { label: 'Remove & delete download', icon: Trash2, danger: true, onSelect: () => run('remove') },
  ];
  return (
    <div className="flex items-center" title={act.error ? (act.error as Error).message : undefined}>
      {act.isPending ? (
        <LoaderCircle className="m-1.5 size-4 animate-spin text-ink-4" />
      ) : (
        <Menu items={items} label={`Actions for ${item.title}`} trigger={act.isError ? <CircleAlert className="size-4 text-bad" /> : undefined} />
      )}
    </div>
  );
}

export function QueueRow({ item, speedBps, actions = true }: { item: QueueItem; speedBps?: number; actions?: boolean }) {
  const { user } = useAuth();
  const failed = item.trackedStatus === 'error' || item.status === 'failed' || !!item.errorMessage;
  const warn = item.trackedStatus === 'warning';
  const paused = item.status === 'paused';
  const color = item.source === 'sonarr' ? 'var(--color-sonarr)' : 'var(--color-radarr)';
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 py-2.5"
    >
      <FadeImage src={item.poster} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} title={item.source} />
          <span className="truncate text-[13px] font-medium">{item.title}</span>
        </div>
        <div className="truncate text-[11px] text-ink-3" title={item.releaseTitle}>
          {[item.instanceName, item.subtitle, item.quality, item.client].filter(Boolean).join(' · ')}
        </div>
        <ProgressBar
          value={item.progress}
          height={3}
          className="mt-1.5"
          glow={false}
          color={failed ? 'var(--color-bad)' : warn ? 'var(--color-warn)' : color}
        />
      </div>
      <div className="w-20 shrink-0 text-right text-[11px] tabular">
        {failed || warn ? (
          <span className={`inline-flex items-center gap-1 ${failed ? 'text-bad' : 'text-warn'}`} title={item.errorMessage ?? item.warnings.join('\n')}>
            <CircleAlert className="size-3" /> {failed ? 'Error' : 'Warning'}
          </span>
        ) : paused ? (
          <span className="inline-flex items-center gap-1 text-ink-3"><Pause className="size-3" /> Paused</span>
        ) : (
          <>
            <div className="font-medium text-ink-2">{Math.round(item.progress * 100)}%</div>
            <div className="text-ink-4">{speedBps ? speed(speedBps) : item.timeLeft ?? bytes(item.sizeLeft)}</div>
          </>
        )}
      </div>
      {actions && user?.isAdmin && <QueueMenu item={item} />}
    </motion.li>
  );
}

export function DownloadsWidget({ limit = 5 }: { limit?: number }) {
  const dl = useDownloads();
  const all = [...useArrAll('sonarr'), ...useArrAll('radarr')];
  const items = all.flatMap((r) => r.data?.queue.items ?? []).sort(
    (a, b) => Number(b.status === 'downloading') - Number(a.status === 'downloading') || b.progress - a.progress,
  );
  const total = all.reduce((n, r) => n + (r.data?.queue.total ?? 0), 0);
  const loading = all.some((r) => r.isPending && r.fetchStatus !== 'idle');
  const remaining = items.reduce((a, i) => a + i.sizeLeft, 0);
  const latest = dl.data?.history.at(-1);

  return (
    <Card className="h-full">
      <CardHeader icon={Download} title="Download activity" subtitle={`${total} in queue · ${bytes(remaining)} remaining`} />
      <CardBody>
        {dl.data && !dl.data.available ? (
          <EmptyState icon={Download} title="No download managers connected" description="Connect Sonarr or Radarr to track download activity." />
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-3xl font-semibold tracking-tight tabular">
                  <AnimatedNumber value={dl.data?.current ?? 0} format={(n) => speed(n)} />
                </div>
                <div className="mt-0.5 text-xs text-ink-3">Combined throughput · peak {speed(dl.data?.peak)}</div>
              </div>
              <Legend
                items={[
                  { label: 'Sonarr', color: SERIES.sonarr, value: latest ? speed(latest.sonarr) : undefined },
                  { label: 'Radarr', color: SERIES.radarr, value: latest ? speed(latest.radarr) : undefined },
                ]}
              />
            </div>
            <div className="mt-3 h-24">
              <ResponsiveContainer>
                <AreaChart data={dl.data?.history ?? []} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <AreaGradient id="g-sonarr" color={SERIES.sonarr} />
                    <AreaGradient id="g-radarr" color={SERIES.radarr} />
                  </defs>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="t" hide />
                  <YAxis {...axisProps} hide />
                  <Tooltip content={<ChartTooltip formatValue={(v) => speed(v)} formatLabel={timeLabel} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                  <Area type="monotone" stackId="1" dataKey="sonarr" name="Sonarr" stroke={SERIES.sonarr} strokeWidth={2} fill="url(#g-sonarr)" isAnimationActive={false} />
                  <Area type="monotone" stackId="1" dataKey="radarr" name="Radarr" stroke={SERIES.radarr} strokeWidth={2} fill="url(#g-radarr)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 border-t border-line">
              {loading ? (
                <div className="space-y-3 pt-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
              ) : items.length === 0 ? (
                <EmptyState icon={Download} title="Queue is empty" description="Nothing downloading right now." className="py-6" />
              ) : (
                <ul className="divide-y divide-line">
                  <AnimatePresence initial={false}>
                    {items.slice(0, limit).map((i) => (
                      <QueueRow key={`${i.instance}-${i.id}`} item={i} speedBps={dl.data?.itemSpeeds[`${i.instance}:${i.id}`]} />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

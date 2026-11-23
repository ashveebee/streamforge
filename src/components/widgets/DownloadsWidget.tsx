import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, Download, Pause } from 'lucide-react';
import { useDownloads, useRadarr, useSonarr } from '@/hooks/queries';
import { bytes, speed } from '@/lib/format';
import type { QueueItem } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { AreaGradient, axisProps, ChartTooltip, gridProps, Legend, SERIES, timeLabel } from '../ui/Chart';
import { FadeImage } from '../ui/Image';
import { ProgressBar } from '../ui/Progress';
import { EmptyState, Skeleton } from '../ui/States';
import { AnimatedNumber } from '../ui/AnimatedNumber';

export function QueueRow({ item, speedBps }: { item: QueueItem; speedBps?: number }) {
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
          {[item.subtitle, item.quality, item.client].filter(Boolean).join(' · ')}
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
    </motion.li>
  );
}

export function DownloadsWidget({ limit = 5 }: { limit?: number }) {
  const dl = useDownloads();
  const sonarr = useSonarr();
  const radarr = useRadarr();
  const items = [...(sonarr.data?.queue.items ?? []), ...(radarr.data?.queue.items ?? [])].sort(
    (a, b) => Number(b.status === 'downloading') - Number(a.status === 'downloading') || b.progress - a.progress,
  );
  const total = (sonarr.data?.queue.total ?? 0) + (radarr.data?.queue.total ?? 0);
  const loading = (sonarr.isPending && sonarr.fetchStatus !== 'idle') || (radarr.isPending && radarr.fetchStatus !== 'idle');
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
                      <QueueRow key={`${i.source}-${i.id}`} item={i} speedBps={dl.data?.itemSpeeds[`${i.source}:${i.id}`]} />
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

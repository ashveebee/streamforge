import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Server } from 'lucide-react';
import { useHost } from '@/hooks/queries';
import { bitrate, bytes, pct } from '@/lib/format';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { AreaGradient, axisProps, ChartTooltip, gridProps, Legend, SERIES, timeLabel } from '../ui/Chart';
import { RingGauge, usageColor } from '../ui/Progress';
import { EmptyState, QueryState, Skeleton } from '../ui/States';
import { t } from '@/i18n';

function Gauge({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof Cpu }) {
  return (
    <div className="flex items-center gap-4">
      <RingGauge value={value} size={84} stroke={8} color={usageColor(value)}>
        <span className="text-base font-semibold tabular">{pct(value)}</span>
      </RingGauge>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
          <Icon className="size-3.5" />
          {label}
        </div>
        <div className="mt-1 truncate text-sm text-ink-2 tabular">{detail}</div>
      </div>
    </div>
  );
}

export function SystemResourcesWidget({ detailed = false }: { detailed?: boolean }) {
  const q = useHost();
  return (
    <Card className="h-full">
      <CardHeader
        icon={Server}
        title={t('dashboard.widgets.resources')}
        subtitle={q.data?.info ? t('widgets.resources.cores', { host: q.data.info.hostname, count: q.data.info.cores }) : t('widgets.resources.host')}
      />
      <CardBody>
        <QueryState
          query={q}
          skeleton={<Skeleton className="h-56" />}
          isEmpty={(d) => !d.enabled || !d.current}
          empty={
            <EmptyState
              icon={Server}
              title={q.data?.enabled === false ? t('widgets.resources.disabled') : t('widgets.resources.collecting')}
              description={q.data?.error ?? t('widgets.resources.enableHint')}
            />
          }
        >
          {(d) => {
            const c = d.current!;
            const data = d.history.map((h) => ({ t: h.t, cpu: h.cpu / 100, mem: h.mem, rx: h.rx, tx: h.tx }));
            return (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
                  <Gauge label="CPU" value={c.cpu / 100} icon={Cpu} detail={t('widgets.resources.load', { load: c.load.map((l) => l.toFixed(2)).join(' · ') })} />
                  <Gauge label={t('widgets.resources.memory')} value={c.memUsed / c.memTotal} icon={MemoryStick} detail={t('ui.usedOf', { used: bytes(c.memUsed), total: bytes(c.memTotal) })} />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Legend items={[{ label: 'CPU', color: SERIES.cpu }, { label: t('widgets.resources.memory'), color: SERIES.mem }]} />
                    <span className="text-[11px] text-ink-4">{(() => { const span = d.history.length > 1 ? (d.history.at(-1)!.t - d.history[0].t) / 1000 : 0; return span < 90 ? t('widgets.resources.lastSeconds', { n: Math.round(span) }) : t('widgets.resources.lastMinutes', { n: Math.round(span / 60) }); })()}</span>
                  </div>
                  <div className="h-36">
                    <ResponsiveContainer>
                      <AreaChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                        <defs>
                          <AreaGradient id="g-cpu" color={SERIES.cpu} />
                          <AreaGradient id="g-mem" color={SERIES.mem} />
                        </defs>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="t" hide />
                        <YAxis {...axisProps} domain={[0, 1]} ticks={[0, 0.5, 1]} tickFormatter={(v) => pct(v)} />
                        <Tooltip content={<ChartTooltip formatValue={(v) => pct(v, 1)} formatLabel={timeLabel} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                        <Area type="monotone" dataKey="mem" name={t('widgets.resources.memory')} stroke={SERIES.mem} strokeWidth={2} fill="url(#g-mem)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="cpu" name="CPU" stroke={SERIES.cpu} strokeWidth={2} fill="url(#g-cpu)" isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <Legend
                      items={[
                        { label: t('widgets.resources.download'), color: SERIES.rx, value: <span className="inline-flex items-center gap-0.5"><ArrowDown className="size-3" />{bitrate(c.rx)}</span> },
                        { label: t('widgets.resources.upload'), color: SERIES.tx, value: <span className="inline-flex items-center gap-0.5"><ArrowUp className="size-3" />{bitrate(c.tx)}</span> },
                      ]}
                    />
                  </div>
                  <div className={detailed ? 'h-40' : 'h-24'}>
                    <ResponsiveContainer>
                      <AreaChart data={data} margin={{ top: 4, right: 4, left: detailed ? 0 : -18, bottom: 0 }}>
                        <defs>
                          <AreaGradient id="g-rx" color={SERIES.rx} />
                          <AreaGradient id="g-tx" color={SERIES.tx} />
                        </defs>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="t" hide />
                        <YAxis {...axisProps} hide={!detailed} tickFormatter={(v) => bitrate(v).replace(/\.\d /, ' ')} width={64} />
                        <Tooltip content={<ChartTooltip formatValue={(v) => bitrate(v)} formatLabel={timeLabel} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                        <Area type="monotone" dataKey="rx" name={t('widgets.resources.download')} stroke={SERIES.rx} strokeWidth={2} fill="url(#g-rx)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="tx" name={t('widgets.resources.upload')} stroke={SERIES.tx} strokeWidth={2} fill="url(#g-tx)" isAnimationActive={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            );
          }}
        </QueryState>
      </CardBody>
    </Card>
  );
}

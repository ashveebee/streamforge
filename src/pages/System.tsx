import { Link } from 'react-router';
import { motion } from 'motion/react';
import { Activity, CircleCheck, CircleX, Clock, HardDrive, MinusCircle, RefreshCw, Timer, TriangleAlert } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useHealth, useHost, useRecheck } from '@/hooks/queries';
import { pct, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ServiceHealth } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChartTooltip, timeLabel } from '@/components/ui/Chart';
import { SERVICES, ServiceIcon } from '@/components/ui/ServiceIcon';
import { StatTile } from '@/components/ui/Stat';
import { STATUS_META, StatusBadge } from '@/components/ui/Status';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { DownloadsWidget } from '@/components/widgets/DownloadsWidget';
import { StorageWidget, VolumeRow } from '@/components/widgets/StorageWidget';
import { SystemResourcesWidget } from '@/components/widgets/SystemResources';

function ServiceRow({ s, index }: { s: ServiceHealth; index: number }) {
  const meta = SERVICES[s.kind];
  const data = s.history.map((h) => ({ t: h.t, ms: h.ms }));
  const errors = s.issues.filter((i) => i.level === 'error').length;
  const warnings = s.issues.filter((i) => i.level === 'warning').length;
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[minmax(200px,1.2fr)_minmax(110px,0.8fr)_repeat(3,minmax(80px,0.6fr))_minmax(160px,1.2fr)]"
    >
      <Link to={s.instance ? `${meta.path}?instance=${encodeURIComponent(s.instance)}` : meta.path} className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
        <ServiceIcon id={s.kind} size={36} />
        <div className="min-w-0">
          <div className="truncate font-medium">{s.name}</div>
          <div className="truncate text-[11px] text-ink-4">{s.version ? `v${s.version}` : meta.tagline}</div>
        </div>
      </Link>
      <div className="justify-self-end md:justify-self-start">
        <StatusBadge status={s.status} />
        {(errors > 0 || warnings > 0) && (
          <div className="mt-1 text-[11px] text-ink-4">
            {errors > 0 && <span className="text-bad">{errors} error{errors > 1 ? 's' : ''}</span>}
            {errors > 0 && warnings > 0 && ' · '}
            {warnings > 0 && <span className="text-warn">{warnings} warning{warnings > 1 ? 's' : ''}</span>}
          </div>
        )}
      </div>
      <div className="col-span-3 grid grid-cols-3 gap-4 md:contents">
        <div>
          <div className="text-[11px] text-ink-4 md:hidden">Response</div>
          <div className="text-sm font-medium tabular">{s.latencyMs !== undefined ? `${s.latencyMs} ms` : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-4 md:hidden">Uptime</div>
          <div className="text-sm font-medium tabular">{s.uptime !== undefined ? pct(s.uptime, s.uptime < 1 ? 1 : 0) : '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-ink-4 md:hidden">Last healthy</div>
          <div className="text-sm text-ink-2" title={s.lastSuccess}>{s.lastSuccess ? relative(s.lastSuccess) : s.configured ? 'Never' : '—'}</div>
        </div>
      </div>
      <div className="col-span-3 h-10 md:col-span-1">
        {s.configured ? (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
              <YAxis hide domain={[0, 'dataMax']} />
              <XAxis dataKey="t" hide />
              <Tooltip content={<ChartTooltip formatLabel={timeLabel} formatValue={(v) => (Number.isFinite(v) ? `${v} ms` : 'failed')} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
              <Line type="monotone" dataKey="ms" name="Response" stroke={meta.color} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center text-xs text-ink-4">Not configured</div>
        )}
      </div>
      {s.status !== 'healthy' && s.reason && (
        <div className={cn('col-span-3 -mt-1 text-xs md:col-span-6', s.status === 'offline' ? 'text-bad' : 'text-warn')}>{s.reason}</div>
      )}
    </motion.li>
  );
}

export default function SystemPage() {
  const q = useHealth();
  const host = useHost();
  const recheck = useRecheck();
  const s = q.data?.summary;
  const overall = !s ? undefined : s.offline ? 'offline' : s.degraded ? 'degraded' : 'healthy';

  return (
    <>
      <PageHeader
        eyebrow="Infrastructure"
        title="System Status"
        description={
          q.data?.checkedAt
            ? `Health checks every ${Math.round(q.data.intervalMs / 1000)}s · last run ${relative(q.data.checkedAt)}`
            : 'Running first health check…'
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
            <RefreshCw className={cn('size-3.5', recheck.isPending && 'animate-spin')} /> Run checks now
          </Button>
        }
      />

      {overall && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="card mb-5 flex items-center gap-4 overflow-hidden p-5"
          style={{ background: `radial-gradient(80% 140% at 0% 50%, color-mix(in oklab, ${STATUS_META[overall].color} 14%, transparent), transparent 70%), var(--color-surface)` }}
        >
          <div className="relative grid size-12 place-items-center rounded-2xl" style={{ background: `color-mix(in oklab, ${STATUS_META[overall].color} 18%, transparent)` }}>
            {overall === 'healthy' ? <CircleCheck className="size-6 text-ok" /> : overall === 'degraded' ? <TriangleAlert className="size-6 text-warn" /> : <CircleX className="size-6 text-bad" />}
          </div>
          <div>
            <div className="text-lg font-semibold">
              {overall === 'healthy' ? 'All systems operational' : overall === 'degraded' ? 'Some services are degraded' : 'Service disruption detected'}
            </div>
            <div className="text-sm text-ink-3">
              {s!.healthy} healthy · {s!.degraded} degraded · {s!.offline} offline{s!.unconfigured ? ` · ${s!.unconfigured} not configured` : ''}
            </div>
          </div>
        </motion.div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Healthy" value={s?.healthy} icon={CircleCheck} accent="var(--color-ok)" />
        <StatTile label="Degraded" value={s?.degraded} icon={TriangleAlert} accent="var(--color-warn)" />
        <StatTile label="Offline" value={s?.offline} icon={CircleX} accent="var(--color-bad)" />
        <StatTile
          label="Avg response"
          value={(() => {
            const l = q.data?.services.filter((x) => x.latencyMs !== undefined).map((x) => x.latencyMs!) ?? [];
            return l.length ? l.reduce((a, b) => a + b, 0) / l.length : undefined;
          })()}
          format={(n) => `${Math.round(n)} ms`}
          icon={Timer}
          accent="var(--color-brand)"
        />
      </div>

      <Card className="mb-5">
        <CardHeader icon={Activity} title="Service health" subtitle="API connectivity, response time and availability over the last checks" />
        <div className="hidden grid-cols-[minmax(200px,1.2fr)_minmax(110px,0.8fr)_repeat(3,minmax(80px,0.6fr))_minmax(160px,1.2fr)] gap-x-4 border-y border-line px-5 py-2 text-[11px] font-medium tracking-wide text-ink-4 uppercase md:grid">
          <span>Service</span>
          <span>Status</span>
          <span>Response</span>
          <span>Uptime</span>
          <span className="flex items-center gap-1"><Clock className="size-3" /> Last healthy</span>
          <span>Response history</span>
        </div>
        {q.data ? (
          <ul className="divide-y divide-line">
            {q.data.services.map((svc, i) => <ServiceRow key={svc.id} s={svc} index={i} />)}
          </ul>
        ) : (
          <div className="space-y-3 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        )}
        <div className="flex items-center gap-4 border-t border-line px-5 py-3 text-[11px] text-ink-4">
          {(['healthy', 'degraded', 'offline', 'unconfigured'] as const).map((k) => {
            const Icon = k === 'unconfigured' ? MinusCircle : STATUS_META[k].icon;
            return <span key={k} className="inline-flex items-center gap-1"><Icon className="size-3" style={{ color: STATUS_META[k].color }} />{STATUS_META[k].label}</span>;
          })}
          <span className="ml-auto hidden sm:inline">Degraded = errors reported by the service or response slower than threshold</span>
        </div>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <SystemResourcesWidget detailed />
        {/* Wrappers give the cards an auto height so they stack instead of stretching. */}
        <div className="flex flex-col gap-5">
          <div><DownloadsWidget limit={4} /></div>
          <div><StorageWidget /></div>
        </div>
      </div>

      {host.data?.filesystems && host.data.filesystems.length > 0 && (
        <Card className="mt-5">
          <CardHeader icon={HardDrive} title="Host filesystems" subtitle={host.data.info ? `${host.data.info.distro ?? host.data.info.platform} · ${host.data.info.cpuModel}` : undefined} />
          <CardBody>
            {host.data.filesystems.length ? (
              <ul className="grid gap-x-8 md:grid-cols-2 [&>li]:border-b [&>li]:border-line">
                {host.data.filesystems.map((f) => (
                  <VolumeRow key={f.fs} v={{ id: f.fs, name: f.mount, mount: `${f.fs} · ${f.type}`, total: f.size, used: f.used, free: f.available, usage: f.usage }} />
                ))}
              </ul>
            ) : (
              <EmptyState icon={HardDrive} title="No filesystems" />
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}

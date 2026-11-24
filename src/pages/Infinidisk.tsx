import { CircleCheck, HardDrive, Thermometer, TriangleAlert, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useInfinidisk } from '@/hooks/queries';
import { bytes, pct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { RingGauge, usageColor, ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { DRIVE_HEALTH } from '@/components/widgets/StorageWidget';

export default function InfinidiskPage() {
  const q = useInfinidisk();
  return (
    <>
      <ServiceHeader id="infinidisk" />
      <QueryState query={q} skeleton={<PageLoader label="Loading storage" hint="Reading drives and capacity…" />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardBody className="flex flex-col items-center gap-4 pt-6">
                  <RingGauge value={d.totals.usage} size={180} stroke={14} color={usageColor(d.totals.usage)}>
                    <div>
                      <div className="text-3xl font-semibold tabular">{pct(d.totals.usage)}</div>
                      <div className="text-xs text-ink-4">of {bytes(d.totals.total)}</div>
                    </div>
                  </RingGauge>
                  <div className="grid w-full grid-cols-2 gap-3 text-center">
                    <div className="rounded-xl border border-line bg-white/[0.02] p-3"><div className="font-semibold tabular">{bytes(d.totals.used)}</div><div className="text-[11px] text-ink-4">Used</div></div>
                    <div className="rounded-xl border border-line bg-white/[0.02] p-3"><div className="font-semibold tabular">{bytes(d.totals.free)}</div><div className="text-[11px] text-ink-4">Available</div></div>
                  </div>
                </CardBody>
              </Card>
              <div className="grid grid-cols-2 gap-3 lg:col-span-2">
                <StatTile label="Drives" value={d.counts.total} icon={HardDrive} accent="var(--color-infinidisk)" hint={d.sources.remote ? `Infinidisk API${d.sources.local ? ` + ${d.sources.local} local mounts` : ''}` : `${d.sources.local} local mounts`} />
                <StatTile label="Healthy" value={d.counts.healthy} icon={CircleCheck} accent="var(--color-ok)" />
                <StatTile label="Warnings" value={d.counts.warning} icon={TriangleAlert} accent="var(--color-warn)" />
                <StatTile label="Critical / offline" value={d.counts.critical + d.counts.offline} icon={XCircle} accent="var(--color-bad)" />
              </div>
            </div>

            <Card>
              <CardHeader icon={HardDrive} accent="var(--color-infinidisk)" title="Mounted drives" subtitle={`${d.drives.length} volumes`} />
              <CardBody>
                {d.drives.length === 0 ? (
                  <EmptyState icon={HardDrive} title="No drives reported" description="Check INFINIDISK_STATUS_PATH or INFINIDISK_MOUNTS on the server." />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {d.drives.map((dr, i) => {
                      const h = DRIVE_HEALTH[dr.health];
                      return (
                        <motion.div
                          key={dr.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.04 }}
                          className="rounded-2xl border border-line bg-white/[0.02] p-4"
                        >
                          <div className="flex items-start gap-3">
                            <div className="grid size-10 place-items-center rounded-xl border border-line bg-infinidisk/10">
                              <HardDrive className="size-5 text-infinidisk" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{dr.name}</div>
                              <div className="truncate font-mono text-[11px] text-ink-4">{dr.mount ?? '—'}</div>
                            </div>
                            <span className={cn('text-xs font-medium', h.tone)}>{h.label}</span>
                          </div>
                          <ProgressBar value={dr.usage} height={6} className="mt-4" glow={false} color={usageColor(dr.usage) ?? 'linear-gradient(90deg,#2dd4bf,#22d3ee)'} label={`${dr.name} usage`} />
                          <div className="mt-2 flex justify-between text-xs text-ink-3 tabular">
                            <span>{bytes(dr.used)} used</span>
                            <span>{bytes(dr.free)} free</span>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <Pill>{bytes(dr.total)}</Pill>
                            {dr.filesystem && <Pill>{dr.filesystem}</Pill>}
                            {dr.readOnly && <Pill tone="warn">Read-only</Pill>}
                            {dr.temperature !== undefined && <Pill tone={dr.temperature > 55 ? 'warn' : 'neutral'}><Thermometer className="size-3" />{Math.round(dr.temperature)}°C</Pill>}
                            <Pill>{dr.source === 'remote' ? 'API' : 'Local'}</Pill>
                          </div>
                          {dr.healthDetail && dr.health !== 'healthy' && <p className={cn('mt-2 text-xs', h.tone)}>{dr.healthDetail}</p>}
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}

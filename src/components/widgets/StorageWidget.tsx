import { HardDrive, Thermometer } from 'lucide-react';
import { useConfigured, useHost, useInfinidisk } from '@/hooks/queries';
import { bytes, pct } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { DriveHealth } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ProgressBar, RingGauge, usageColor } from '../ui/Progress';
import { EmptyState, ErrorState, Skeleton } from '../ui/States';

export const DRIVE_HEALTH: Record<DriveHealth, { label: string; tone: string }> = {
  healthy: { label: 'Healthy', tone: 'text-ok' },
  warning: { label: 'Warning', tone: 'text-warn' },
  critical: { label: 'Critical', tone: 'text-bad' },
  offline: { label: 'Offline', tone: 'text-bad' },
  unknown: { label: 'Unknown', tone: 'text-ink-3' },
};

interface Vol {
  id: string;
  name: string;
  mount?: string;
  total: number;
  used: number;
  free: number;
  usage: number;
  health?: DriveHealth;
  detail?: string;
  temperature?: number;
}

export function VolumeRow({ v }: { v: Vol }) {
  const h = v.health ? DRIVE_HEALTH[v.health] : undefined;
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <HardDrive className="size-4 shrink-0 text-ink-4" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-medium" title={v.mount}>{v.name}</span>
            <span className="shrink-0 text-[11px] text-ink-3 tabular">
              {bytes(v.free)} free of {bytes(v.total)}
            </span>
          </div>
          <ProgressBar value={v.usage} height={4} className="mt-1.5" glow={false} color={usageColor(v.usage) ?? 'linear-gradient(90deg,#a78bfa,#22d3ee)'} label={`${v.name} usage`} />
          <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-4">
            {v.mount && v.mount !== v.name && <span className="truncate font-mono">{v.mount}</span>}
            <span className="flex-1" />
            {v.temperature !== undefined && (
              <span className="inline-flex items-center gap-0.5"><Thermometer className="size-3" />{Math.round(v.temperature)}°C</span>
            )}
            {h && <span className={cn('font-medium capitalize', h.tone)} title={v.detail}>{v.detail && v.health !== 'healthy' ? v.detail : h.label}</span>}
            <span className="tabular">{pct(v.usage)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

export function StorageWidget() {
  const infinidiskOn = useConfigured('infinidisk');
  const inf = useInfinidisk();
  const host = useHost();

  const fromInf = infinidiskOn && inf.data && inf.data.drives.length > 0;
  const vols: Vol[] = fromInf
    ? inf.data!.drives.map((d) => ({ ...d, detail: d.healthDetail }))
    : (host.data?.filesystems ?? []).map((f) => ({
        id: f.fs,
        name: f.mount,
        mount: f.fs,
        total: f.size,
        used: f.used,
        free: f.available,
        usage: f.usage,
      }));
  const totals = vols.reduce((a, v) => ({ total: a.total + v.total, used: a.used + v.used, free: a.free + v.free }), { total: 0, used: 0, free: 0 });
  const usage = totals.total ? totals.used / totals.total : 0;
  const loading = (infinidiskOn && inf.isPending) || (!fromInf && host.isPending);

  return (
    <Card className="h-full">
      <CardHeader
        icon={HardDrive}
        accent="var(--color-infinidisk)"
        title="Storage"
        subtitle={fromInf ? `Infinidisk · ${vols.length} drives` : 'Host filesystems'}
      />
      <CardBody>
        {loading ? (
          <Skeleton className="h-48" />
        ) : infinidiskOn && inf.isError && !host.data?.filesystems.length ? (
          <ErrorState error={inf.error} onRetry={() => void inf.refetch()} />
        ) : vols.length === 0 ? (
          <EmptyState icon={HardDrive} title="No storage reported" description="Configure Infinidisk or enable host metrics to see storage." />
        ) : (
          <>
            <div className="flex items-center gap-5">
              <RingGauge value={usage} size={104} stroke={9} color={usageColor(usage)}>
                <div>
                  <div className="text-lg font-semibold tabular">{pct(usage)}</div>
                  <div className="text-[10px] text-ink-4">used</div>
                </div>
              </RingGauge>
              <div className="grid flex-1 grid-cols-1 gap-2 text-sm">
                <div><div className="text-[11px] text-ink-4">Capacity</div><div className="font-semibold tabular">{bytes(totals.total)}</div></div>
                <div><div className="text-[11px] text-ink-4">Used</div><div className="font-medium text-ink-2 tabular">{bytes(totals.used)}</div></div>
                <div><div className="text-[11px] text-ink-4">Available</div><div className="font-medium text-ink-2 tabular">{bytes(totals.free)}</div></div>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {vols.slice(0, 5).map((v) => <VolumeRow key={v.id} v={v} />)}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

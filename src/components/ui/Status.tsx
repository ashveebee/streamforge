import { CircleCheck, CircleX, MinusCircle, TriangleAlert } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';
import { cn } from '@/lib/cn';

export const STATUS_META: Record<ServiceStatus, { label: string; color: string; icon: typeof CircleCheck }> = {
  healthy: { label: 'Healthy', color: 'var(--color-ok)', icon: CircleCheck },
  degraded: { label: 'Degraded', color: 'var(--color-warn)', icon: TriangleAlert },
  offline: { label: 'Offline', color: 'var(--color-bad)', icon: CircleX },
  unconfigured: { label: 'Not configured', color: 'var(--color-idle)', icon: MinusCircle },
};

export function StatusDot({ status, size = 8, pulse = true }: { status: ServiceStatus; size?: number; pulse?: boolean }) {
  const { color } = STATUS_META[status];
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {pulse && status !== 'unconfigured' && (
        <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ background: color }} />
      )}
      <span className="relative inline-flex size-full rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
    </span>
  );
}

/** Status is never colour-alone: always icon + label. */
export function StatusBadge({ status, className, compact }: { status: ServiceStatus; className?: string; compact?: boolean }) {
  const { label, color, icon: Icon } = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        className,
      )}
      style={{ color, borderColor: `color-mix(in oklab, ${color} 30%, transparent)`, background: `color-mix(in oklab, ${color} 10%, transparent)` }}
    >
      <Icon className="size-3" />
      {!compact && label}
    </span>
  );
}

export function Pill({ children, className, tone = 'neutral' }: { children: React.ReactNode; className?: string; tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' }) {
  const tones = {
    neutral: 'border-line-strong bg-white/[0.04] text-ink-2',
    brand: 'border-brand/30 bg-brand/10 text-brand',
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    bad: 'border-bad/30 bg-bad/10 text-bad',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase', tones[tone], className)}>
      {children}
    </span>
  );
}

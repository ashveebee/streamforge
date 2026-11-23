import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

export function ProgressBar({
  value,
  className,
  color = 'linear-gradient(90deg, var(--color-brand), var(--color-brand-2))',
  height = 6,
  glow = true,
  label,
}: {
  value: number;
  className?: string;
  color?: string;
  height?: number;
  glow?: boolean;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
      className={cn('relative w-full overflow-hidden rounded-full bg-white/[0.07]', className)}
      style={{ height }}
    >
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: color, boxShadow: glow ? '0 0 12px -2px rgb(167 139 250 / 0.6)' : undefined }}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={{ type: 'spring', stiffness: 80, damping: 20 }}
      />
    </div>
  );
}

/** Usage colour: neutral brand until it gets tight, then warning/critical. */
export function usageColor(v: number): string | undefined {
  if (v >= 0.95) return 'var(--color-bad)';
  if (v >= 0.85) return 'var(--color-warn)';
  return undefined;
}

export function RingGauge({
  value,
  size = 120,
  stroke = 10,
  color,
  children,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const v = Math.max(0, Math.min(1, value || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const id = `ring-${size}-${stroke}`;
  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c4b5fd" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color ?? `url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 6px ${color ?? 'rgb(167 139 250 / 0.45)'})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

import type { ComponentType, ReactNode } from 'react';
import { motion } from 'motion/react';
import { AnimatedNumber } from './AnimatedNumber';
import { cn } from '@/lib/cn';

export function StatTile({
  label,
  value,
  format,
  hint,
  icon: Icon,
  accent,
  className,
  children,
}: {
  label: string;
  value: number | undefined;
  format?: (n: number) => string;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <motion.div
      layout
      className={cn('group relative overflow-hidden rounded-2xl border border-line bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.04]', className)}
    >
      {accent && (
        <div
          className="pointer-events-none absolute -top-10 -right-10 size-28 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-35"
          style={{ background: accent }}
        />
      )}
      <div className="flex items-center gap-2 text-xs font-medium text-ink-3">
        {Icon && <Icon className="size-3.5" style={{ color: accent }} />}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink tabular">
        <AnimatedNumber value={value} format={format} />
      </div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
      {children}
    </motion.div>
  );
}

/** Compact label/value pair for dense detail lists. */
export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-1.5 text-[13px]', className)}>
      <span className="text-ink-3">{k}</span>
      <span className="truncate text-right font-medium text-ink-2 tabular">{v}</span>
    </div>
  );
}

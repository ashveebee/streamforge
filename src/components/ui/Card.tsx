import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' | 'article' }) {
  return <As className={cn('card overflow-hidden', className)}>{children}</As>;
}

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  accent,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex items-start gap-3 px-5 pt-5 pb-3', className)}>
      {Icon && (
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.03]"
          style={accent ? { boxShadow: `inset 0 0 16px -6px ${accent}` } : undefined}
        >
          <Icon className="size-4" style={{ color: accent ?? 'var(--color-ink-2)' }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 pb-5', className)}>{children}</div>;
}

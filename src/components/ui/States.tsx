import type { ComponentType, ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { PlugZap, RefreshCw, Settings, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded-lg', className)} />;
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-2xl bg-brand/20 blur-xl" />
        <div className="relative grid size-12 place-items-center rounded-2xl border border-line-strong bg-surface-2">
          <Icon className="size-5 text-ink-2" />
        </div>
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs leading-relaxed text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </motion.div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const e = error as ApiError;
  if (e instanceof ApiError && e.notConfigured) {
    return (
      <EmptyState
        className={className}
        icon={PlugZap}
        title="Not connected"
        description="Add this service's address and API key in Settings to enable it."
        action={
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            <Settings className="size-3" /> Open Settings
          </Link>
        }
      />
    );
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-8 text-center', className)}>
      <div className="grid size-10 place-items-center rounded-xl border border-bad/25 bg-bad/10">
        <TriangleAlert className="size-4.5 text-bad" />
      </div>
      <div>
        <p className="text-sm font-medium text-ink">Couldn't load data</p>
        <p className="mt-1 max-w-sm text-xs break-words text-ink-3">{e?.message ?? 'Unknown error'}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 transition hover:bg-white/5 hover:text-ink"
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * Standard loading / error / empty / data switch for a query. Keeps showing
 * stale data during background refetch errors so the UI never flickers.
 */
export function QueryState<T>({
  query,
  skeleton,
  empty,
  isEmpty,
  children,
  className,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (data: T) => ReactNode;
  className?: string;
}) {
  if (query.data !== undefined) {
    if (isEmpty?.(query.data) && empty) return <>{empty}</>;
    return <>{children(query.data)}</>;
  }
  if (query.isError) return <ErrorState className={className} error={query.error} onRetry={() => void query.refetch()} />;
  if (query.fetchStatus === 'idle' && query.isPending) {
    return <ErrorState className={className} error={new ApiError('Not configured', 404, 'not_configured')} />;
  }
  return <>{skeleton ?? <SkeletonRows className={className} />}</>;
}

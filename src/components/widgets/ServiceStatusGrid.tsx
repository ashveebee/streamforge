import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useHealth } from '@/hooks/queries';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ServiceHealth } from '@/lib/types';
import { healthMeta, ServiceIcon } from '../ui/ServiceIcon';
import { Sparkline } from '../ui/Sparkline';
import { STATUS_META, StatusBadge } from '../ui/Status';
import { Skeleton } from '../ui/States';
import { t } from '@/i18n';

export function ServiceTile({ s, index = 0 }: { s: ServiceHealth; index?: number }) {
  const meta = healthMeta(s);
  const color = STATUS_META[s.status].color;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Link
        to={s.instance ? `${meta.path}?instance=${encodeURIComponent(s.instance)}` : meta.path}
        className={cn(
          'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:bg-white/[0.04]',
          s.status === 'unconfigured' && 'opacity-60',
        )}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        />
        <div className="flex items-center gap-3">
          <ServiceIcon id={meta.iconId} size={34} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{s.name}</div>
            <div className="truncate text-[11px] text-ink-4">{s.version ? `v${s.version}` : meta.tagline}</div>
          </div>
        </div>
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <StatusBadge status={s.status} />
            <div className="mt-1.5 truncate text-[11px] text-ink-4" title={s.reason}>
              {s.status === 'unconfigured'
                ? t('widgets.services.addCredentials')
                : s.reason ?? (s.latencyMs !== undefined ? `${s.latencyMs} ms · ${relative(s.lastSuccess)}` : t('widgets.services.checking'))}
            </div>
          </div>
          {s.configured && (
            <Sparkline data={s.history.slice(-30).map((h) => h.ms)} width={72} height={28} color={meta.color} className="shrink-0 opacity-80" />
          )}
        </div>
      </Link>
    </motion.div>
  );
}

export function ServiceStatusGrid() {
  const q = useHealth();
  if (!q.data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-2xl" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
      {q.data.services.map((s, i) => <ServiceTile key={s.id} s={s} index={i} />)}
    </div>
  );
}

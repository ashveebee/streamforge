import { TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSetDiskAlert, useStorageForecast } from '@/hooks/queries';
import { bytes, pct } from '@/lib/format';
import type { StorageForecast } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ProgressBar, usageColor } from '../ui/Progress';
import { Sparkline } from '../ui/Sparkline';
import { EmptyState, SkeletonRows } from '../ui/States';
import { getLocale, t } from '@/i18n';

type Vol = StorageForecast['volumes'][number];

function outlook(v: Vol) {
  if (v.growthPerDay === undefined) return { text: t('widgets.forecast.collecting'), tone: 'text-ink-4' };
  if (v.daysLeft === undefined) return { text: v.growthPerDay < 0 ? t('widgets.forecast.shrinking') : t('widgets.forecast.flat'), tone: 'text-ink-3' };
  const when = v.fullOn ? new Date(v.fullOn).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: v.daysLeft > 300 ? 'numeric' : undefined }) : undefined;
  const tone = v.daysLeft < 30 ? 'text-bad' : v.daysLeft < 90 ? 'text-warn' : 'text-ink-2';
  const span =
    v.daysLeft < 60
      ? t('widgets.forecast.days', { count: v.daysLeft })
      : v.daysLeft < 730
        ? t('widgets.forecast.months', { count: Math.round(v.daysLeft / 30) })
        : t('widgets.forecast.years', { count: Math.round(v.daysLeft / 36.5) / 10 });
  return { text: when ? t('widgets.forecast.fullOn', { span, when }) : t('widgets.forecast.full', { span }), tone };
}

/** Usage over time, scaled to the visible range (at least 2% of capacity so noise stays flat). */
function UsageTrend({ v }: { v: Vol }) {
  const vals = v.history.map((h) => h.used);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, v.total * 0.01);
  return <Sparkline data={vals} width={96} height={32} color="#2dd4bf" domain={[lo - pad, hi + pad]} className="hidden shrink-0 sm:block" />;
}

/** Disk usage trends and when each volume will fill up. */
export function StorageForecastCard() {
  const { user } = useAuth();
  const q = useStorageForecast();
  const alert = useSetDiskAlert();
  const d = q.data;
  return (
    <Card>
      <CardHeader
        icon={TrendingUp}
        accent="var(--color-infinidisk)"
        title={t('widgets.forecast.title')}
        subtitle={t('widgets.forecast.subtitle')}
        action={
          user?.isAdmin && d ? (
            <label className="flex items-center gap-2 text-xs text-ink-3">
              {t('widgets.forecast.alertAt')}
              <select
                className="h-8 rounded-lg border border-line-strong bg-surface-2 px-2 text-xs text-ink outline-none"
                value={d.alertPercent}
                disabled={alert.isPending}
                onChange={(e) => alert.mutate(Number(e.target.value))}
              >
                {[75, 80, 85, 90, 95, 98].map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
            </label>
          ) : undefined
        }
      />
      <CardBody>
        {!d ? (
          <SkeletonRows rows={3} />
        ) : !d.volumes.length ? (
          <EmptyState icon={TrendingUp} title={t('widgets.forecast.none')} description={t('widgets.forecast.noneHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {d.volumes.map((v) => {
              const o = outlook(v);
              return (
                <li key={v.key} className="flex items-center gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{v.label}</span>
                      <span className="shrink-0 text-[11px] text-ink-3 tabular">{t('ui.usedOf', { used: bytes(v.used), total: bytes(v.total) })} · {pct(v.usage)}</span>
                    </div>
                    <ProgressBar value={v.usage} height={4} glow={false} color={usageColor(v.usage)} className="mt-1.5" />
                    <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px]">
                      <span className={o.tone}>{o.text}</span>
                      {v.growthPerDay !== undefined && Math.abs(v.growthPerDay) >= 1024 ** 2 && (
                        <span className="text-ink-4 tabular">{v.growthPerDay > 0 ? '+' : '−'}{t('widgets.forecast.perDay', { size: bytes(Math.abs(v.growthPerDay)) })}</span>
                      )}
                    </div>
                  </div>
                  <UsageTrend v={v} />
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

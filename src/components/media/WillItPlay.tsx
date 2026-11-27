import { MonitorPlay } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTitlePlayability, VERDICT } from '@/hooks/usePlayability';
import { Card, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { SkeletonRows } from '@/components/ui/States';
import { t } from '@/i18n';

/**
 * "Will it play?": how this movie or series would play on each device people
 * watch on, from what those devices have played before. Admins only.
 */
export function WillItPlay({ itemId }: { itemId: string }) {
  const { user } = useAuth();
  const q = useTitlePlayability(itemId, !!user?.isAdmin);
  if (!user?.isAdmin || q.isError) return null;
  if (q.data && (!q.data.devices.length || !q.data.files)) return null;
  const series = (q.data?.files ?? 0) > 1;
  return (
    <Card>
      <CardHeader icon={MonitorPlay} accent="var(--color-jellyfin)" title={t('ui.willPlay.title')} subtitle={t('ui.willPlay.subtitle')} />
      {!q.data ? (
        <SkeletonRows rows={3} className="px-5 pb-5" />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {q.data.devices.map((d) => {
            const v = VERDICT[d.verdict];
            const notes = [
              series && d.verdict !== 'direct' ? t('ui.willPlay.episodes', { direct: d.counts.direct, count: q.data!.files }) : undefined,
              d.problems.length ? t('ui.willPlay.because', { list: d.problems.join(', ') }) : undefined,
              d.version ? t('ui.willPlay.version', { version: d.version }) : undefined,
              d.subtitleWarning ? capital(d.subtitleWarning) : undefined,
              d.untested.length ? t('ui.willPlay.untested', { list: d.untested.join(', ') }) : undefined,
            ].filter(Boolean);
            return (
              <li key={d.key} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">{d.device}</div>
                    {d.client && <div className="truncate text-[11px] text-ink-4">{d.client}</div>}
                  </div>
                  <Pill tone={v.tone} className="shrink-0">
                    <span title={v.hint}>{v.label}</span>
                  </Pill>
                </div>
                {notes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-ink-3">
                    {notes.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

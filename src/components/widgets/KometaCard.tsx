import { useQuery } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Images, LoaderCircle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { t } from '@/i18n';

export interface KometaRun {
  id: number;
  at: string;
  startTime?: string;
  endTime?: string;
  runTime?: string;
  created: number;
  modified: number;
  deleted: number;
  added: number;
  removed: number;
  toRadarr: number;
  toSonarr: number;
  errors: number;
}

export interface KometaStatus {
  enabled: boolean;
  waiting: boolean;
  running: boolean;
  runningSince?: string;
  lastRun?: KometaRun;
  errors: { id: number; at: string; error: string; critical: boolean; library?: string; collection?: string; playlist?: string }[];
  version?: { current?: string; latest?: string };
  changes: { id: number; at: string; event: 'changes' | 'delete'; library?: string; collection?: string; playlist?: string; created?: boolean; addedCount?: number; removedCount?: number; additions?: string[]; message?: string }[];
  runs: KometaRun[];
}

export const useKometaStatus = (enabled = true) =>
  useQuery({ queryKey: ['kometa', 'status'], queryFn: () => api<KometaStatus>('/kometa/status'), refetchInterval: 30_000, enabled });

const COLOR = '#f59e0b';

/** Kometa's last run, errors and recent collection changes, from its webhooks. */
export function KometaCard() {
  const q = useKometaStatus();
  const d = q.data;
  if (!d?.enabled) return null;
  const last = d.lastRun;
  const subtitle = d.running
    ? t('widgets.kometa.runningSince', { when: relative(d.runningSince!) })
    : last
      ? `${t('widgets.kometa.finished', { when: relative(last.at) })}${last.runTime ? ` · ${t('widgets.kometa.took', { time: last.runTime })}` : ''}`
      : t('widgets.kometa.waiting');
  return (
    <Card>
      <CardHeader
        icon={Images}
        accent={COLOR}
        title="Kometa"
        subtitle={subtitle}
        action={
          d.running ? (
            <Pill tone="brand"><LoaderCircle className="mr-1 inline size-3 animate-spin" />{t('widgets.kometa.running')}</Pill>
          ) : last ? (
            last.errors ? <Pill tone="warn">{t('widgets.kometa.errors', { count: last.errors })}</Pill> : <Pill tone="ok">OK</Pill>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {d.waiting && (
          <p className="text-xs leading-relaxed text-ink-3">
            {t('widgets.kometa.nothing')}
          </p>
        )}
        {last && (
          <dl className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            {(
              [
                [t('widgets.kometa.created'), last.created],
                [t('widgets.kometa.updated'), last.modified],
                [t('widgets.kometa.removed'), last.deleted],
                [t('widgets.kometa.itemsAdded'), last.added],
                [t('widgets.kometa.itemsRemoved'), last.removed],
                [t('widgets.kometa.toArr'), last.toRadarr + last.toSonarr],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-white/[0.02] px-2 py-2">
                <dd className="text-lg font-semibold tabular">{v}</dd>
                <dt className="text-[10.5px] text-ink-4">{k}</dt>
              </div>
            ))}
          </dl>
        )}
        {d.runs.length > 1 && (
          <div>
            <div className="mb-1.5 text-[11px] text-ink-4">{t('widgets.kometa.runs')}</div>
            <div className="flex items-end gap-1" aria-label={t('widgets.kometa.runs')}>
              {[...d.runs].reverse().map((r) => (
                <span
                  key={r.id}
                  title={`${relative(r.at)}${r.runTime ? ` · ${r.runTime}` : ''}${r.errors ? ` · ${t('widgets.kometa.errors', { count: r.errors })}` : ''}`}
                  className={`h-6 flex-1 rounded ${r.errors ? 'bg-warn/70' : 'bg-ok/60'}`}
                />
              ))}
            </div>
          </div>
        )}
        {d.version?.latest && (
          <p className="flex items-center gap-1.5 text-xs text-ink-2">
            <Sparkles className="size-3.5 text-brand" /> {t('widgets.kometa.update', { latest: d.version.latest, current: d.version.current ?? t('widgets.kometa.older') })}
          </p>
        )}
        {d.errors.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-warn">{d.running ? t('widgets.kometa.errorsNow') : t('widgets.kometa.errorsLast')}</div>
            <ul className="space-y-1.5">
              {d.errors.slice(0, 5).map((e) => (
                <li key={e.id} className="flex gap-2 text-xs">
                  <CircleAlert className={`mt-0.5 size-3.5 shrink-0 ${e.critical ? 'text-bad' : 'text-warn'}`} />
                  <div className="min-w-0">
                    <div className="text-ink-2">{e.error}</div>
                    <div className="text-[11px] text-ink-4">{[e.library, e.collection ?? e.playlist].filter(Boolean).join(' · ') || t('widgets.kometa.global')}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.changes.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] text-ink-4">{t('widgets.kometa.changes')}</div>
            <ul className="space-y-1">
              {d.changes.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <CircleCheck className="size-3.5 shrink-0 text-ink-4" />
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {c.event === 'delete'
                      ? c.message
                      : `${c.collection ?? c.playlist}${c.created ? ` (${t('widgets.kometa.new')})` : ''}: ${[c.addedCount ? `+${c.addedCount}` : '', c.removedCount ? `−${c.removedCount}` : ''].filter(Boolean).join(' ') || t('widgets.kometa.changed')}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-4">{c.library}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

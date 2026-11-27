import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Eye, FileVideo, LoaderCircle, Play, Wand2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAutoImport, useRunAutoImport, useUpdateAutoImport } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/format';
import type { ArrKind, AutoImportEntry, AutoImportMethod, AutoImportOutcome, QueueItem } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { EmptyState } from '@/components/ui/States';
import { t } from '@/i18n';

/** Mirrors the server's notion of "finished downloading but stuck". */
export const isStuck = (i: QueueItem) =>
  i.trackedState === 'importBlocked' ||
  i.trackedState === 'importFailed' ||
  (i.trackedState === 'importPending' && (i.trackedStatus === 'warning' || i.trackedStatus === 'error'));

const OUTCOME: Record<AutoImportOutcome, 'ok' | 'warn' | 'bad' | 'brand' | 'neutral'> = {
  imported: 'ok',
  queued: 'brand',
  preview: 'brand',
  skipped: 'warn',
  failed: 'bad',
};

const METHOD = (m: AutoImportMethod) =>
  m === 'sonarr' ? 'Sonarr' : m === 'radarr' ? 'Radarr' : t(`widgets.import.method.${m === 'grab-history' ? 'grabHistory' : m === 'title-match' ? 'titleMatch' : m}`);

const interval = (m: number) => (m < 60 ? t('widgets.import.minutes', { n: m }) : t('widgets.cleanup.hours', { n: m / 60 }));

function Entry({ e, kind }: { e: AutoImportEntry; kind: ArrKind }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <Pill tone={OUTCOME[e.outcome]} className="mt-0.5 shrink-0">{t(`widgets.import.outcome.${e.outcome}`)}</Pill>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{e.title}</div>
          <div className="truncate text-[11px] text-ink-3">{e.instanceName ? `${e.instanceName} · ` : ''}{e.message}</div>
        </div>
        <span className="shrink-0 text-[11px] text-ink-4" title={e.at}>{e.outcome === 'preview' ? t('widgets.cleanup.preview') : relative(e.at)}</span>
        <ChevronDown className={cn('mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-white/[0.02] p-3 text-[11px]">
              <div className="break-all text-ink-4" title={t('widgets.import.release')}>{e.release}</div>
              {e.files.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <FileVideo className={cn('mt-px size-3 shrink-0', f.ok ? 'text-ok' : 'text-warn')} />
                  <div className="min-w-0">
                    <div className="break-all text-ink-2">{f.name}</div>
                    {f.ok ? (
                      <div className="text-ink-3">
                        → {f.title} {kind === 'radarr' && f.detail ? `(${f.detail})` : f.detail}
                        <span className="text-ink-4">
                          {' '}· {t(kind === 'sonarr' ? 'widgets.import.seriesVia' : 'widgets.import.movieVia', { method: f.titleMethod ? METHOD(f.titleMethod) : '—' })}
                          {kind === 'sonarr' && f.detailMethod ? `, ${t('widgets.import.episodesVia', { method: METHOD(f.detailMethod) })}` : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="text-warn">{f.title ? `${f.title} · ` : ''}{f.reason}</div>
                    )}
                  </div>
                </div>
              ))}
              <div className="text-ink-4">{t('widgets.import.trigger', { by: e.trigger === 'queue' ? t('widgets.import.queueChange') : e.trigger })}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function AutoImportCard({ kind, queue }: { kind: ArrKind; queue: QueueItem[] }) {
  const { user } = useAuth();
  const admin = !!user?.isAdmin;
  const q = useAutoImport(kind);
  const update = useUpdateAutoImport(kind);
  const run = useRunAutoImport(kind);
  const app = kind === 'sonarr' ? 'Sonarr' : 'Radarr';
  const [preview, setPreview] = useState<AutoImportEntry[]>();

  const stuck = queue.filter(isStuck);
  const s = q.data;
  const enabled = !!s?.settings.enabled;
  const busy = run.isPending || !!s?.running;

  const go = async (opts: { dryRun?: boolean; queueId?: number; instance?: string }) => {
    const r = await run.mutateAsync(opts).catch(() => undefined);
    if (r) setPreview(opts.dryRun ? r.results : undefined);
  };

  const subtitle = !s
    ? t('widgets.import.about', { app })
    : enabled
      ? `${t('widgets.cleanup.on')} · ${t('widgets.import.every', { interval: interval(s.settings.intervalMinutes) })}${s.nextRun ? ` · ${t('widgets.import.next', { when: relative(s.nextRun) })}` : ''}`
      : `${t('widgets.cleanup.off')} · ${t('widgets.import.about', { app })}`;

  return (
    <Card className="h-full">
      <CardHeader
        icon={Wand2}
        accent={`var(--color-${kind})`}
        title={t('widgets.import.title')}
        subtitle={subtitle}
        action={
          admin && s ? (
            <Switch checked={enabled} disabled={update.isPending} onChange={(v) => update.mutate({ enabled: v })} label={enabled ? t('widgets.import.turnOff') : t('widgets.import.turnOn')} />
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {admin && s && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-3">
              {t('widgets.import.checkEvery')}
              <select
                className="h-8 rounded-lg border border-line-strong bg-surface-2 px-2 text-xs text-ink outline-none focus:border-brand/60"
                value={s.settings.intervalMinutes}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ intervalMinutes: Number(e.target.value) })}
              >
                {s.intervals.map((m) => <option key={m} value={m}>{interval(m)}</option>)}
              </select>
            </label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void go({ dryRun: true })} title={t('widgets.import.previewHint')}>
                <Eye className="size-3.5" /> {t('widgets.cleanup.preview')}
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void go({})}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                {t('widgets.cleanup.run')}
              </Button>
            </div>
          </div>
        )}

        {(run.error || s?.lastError) && (
          <p className="rounded-xl border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad" role="alert">
            {(run.error as Error | null)?.message ?? s?.lastError}
          </p>
        )}

        {stuck.length > 0 && (
          <div>
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{t('widgets.import.waiting')} · {stuck.length}</h3>
            <ul className="divide-y divide-line">
              {stuck.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{i.title}{i.subtitle ? <span className="text-ink-3"> · {i.subtitle}</span> : null}</div>
                    <div className="truncate text-[11px] text-warn" title={i.warnings.join('\n')}>{i.warnings[0] ?? i.errorMessage ?? t('widgets.import.attention')}</div>
                  </div>
                  {admin && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void go({ queueId: i.id, instance: i.instance })}>
                      {t('widgets.import.try')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {preview && (
          <div>
            <h3 className="mb-1 flex items-center text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
              {t('widgets.cleanup.previewTitle')}
              <button type="button" className="ml-auto font-normal normal-case tracking-normal hover:text-ink-2" onClick={() => setPreview(undefined)}>{t('widgets.cleanup.dismiss')}</button>
            </h3>
            {preview.length ? (
              <ul className="divide-y divide-line">{preview.map((e) => <Entry key={e.id} e={e} kind={kind} />)}</ul>
            ) : (
              <p className="text-xs text-ink-3">{t('widgets.import.nothingWaiting')}</p>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
            {t('widgets.cleanup.recent')}{s?.lastRun ? ` · ${t('widgets.cleanup.lastChecked', { when: relative(s.lastRun) })}` : ''}
          </h3>
          {s?.log.length ? (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">{s.log.map((e) => <Entry key={e.id} e={e} kind={kind} />)}</ul>
          ) : (
            <EmptyState icon={Wand2} title={t('widgets.import.none')} description={t('widgets.import.noneHint', { app })} />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

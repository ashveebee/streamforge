import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Eye, FileVideo, LoaderCircle, Play, Wand2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAutoImport, useRunAutoImport, useUpdateAutoImport } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/format';
import type { AutoImportEntry, AutoImportMethod, AutoImportOutcome, QueueItem } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { EmptyState } from '@/components/ui/States';

/** Mirrors the server's notion of "finished downloading but stuck". */
export const isStuck = (i: QueueItem) =>
  i.trackedState === 'importBlocked' ||
  i.trackedState === 'importFailed' ||
  (i.trackedState === 'importPending' && (i.trackedStatus === 'warning' || i.trackedStatus === 'error'));

const OUTCOME: Record<AutoImportOutcome, { label: string; tone: 'ok' | 'warn' | 'bad' | 'brand' | 'neutral' }> = {
  imported: { label: 'Imported', tone: 'ok' },
  queued: { label: 'Importing', tone: 'brand' },
  preview: { label: 'Would import', tone: 'brand' },
  skipped: { label: 'Skipped', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
};

const METHOD: Record<AutoImportMethod, string> = {
  sonarr: 'Sonarr',
  'grab-history': 'grab history',
  parser: 'release name',
  'title-match': 'title match',
  numbering: 'episode numbering',
};

const interval = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

function Entry({ e }: { e: AutoImportEntry }) {
  const [open, setOpen] = useState(false);
  const o = OUTCOME[e.outcome];
  return (
    <li className="py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-start gap-3 text-left">
        <Pill tone={o.tone} className="mt-0.5 shrink-0">{o.label}</Pill>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{e.title}</div>
          <div className="truncate text-[11px] text-ink-3">{e.message}</div>
        </div>
        <span className="shrink-0 text-[11px] text-ink-4" title={e.at}>{e.outcome === 'preview' ? 'preview' : relative(e.at)}</span>
        <ChevronDown className={cn('mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 space-y-1.5 rounded-xl border border-line bg-white/[0.02] p-3 text-[11px]">
              <div className="break-all text-ink-4" title="Release">{e.release}</div>
              {e.files.map((f, i) => (
                <div key={i} className="flex items-start gap-2">
                  <FileVideo className={cn('mt-px size-3 shrink-0', f.ok ? 'text-ok' : 'text-warn')} />
                  <div className="min-w-0">
                    <div className="break-all text-ink-2">{f.name}</div>
                    {f.ok ? (
                      <div className="text-ink-3">
                        → {f.series} {f.episodes}
                        <span className="text-ink-4">
                          {' '}· series via {METHOD[f.seriesMethod!]}, episodes via {METHOD[f.episodeMethod!]}
                        </span>
                      </div>
                    ) : (
                      <div className="text-warn">{f.series ? `${f.series} · ` : ''}{f.reason}</div>
                    )}
                  </div>
                </div>
              ))}
              <div className="text-ink-4">Triggered by {e.trigger === 'queue' ? 'queue change' : e.trigger}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function AutoImportCard({ queue }: { queue: QueueItem[] }) {
  const { user } = useAuth();
  const admin = !!user?.isAdmin;
  const q = useAutoImport();
  const update = useUpdateAutoImport();
  const run = useRunAutoImport();
  const [preview, setPreview] = useState<AutoImportEntry[]>();

  const stuck = queue.filter(isStuck);
  const s = q.data;
  const enabled = !!s?.settings.enabled;
  const busy = run.isPending || !!s?.running;

  const go = async (opts: { dryRun?: boolean; queueId?: number }) => {
    const r = await run.mutateAsync(opts).catch(() => undefined);
    if (r) setPreview(opts.dryRun ? r.results : undefined);
  };

  const subtitle = !s
    ? 'Imports downloads Sonarr couldn’t match'
    : enabled
      ? `On · every ${interval(s.settings.intervalMinutes)}${s.nextRun ? ` · next ${relative(s.nextRun)}` : ''}`
      : 'Off · imports downloads Sonarr couldn’t match';

  return (
    <Card className="h-full">
      <CardHeader
        icon={Wand2}
        accent="var(--color-sonarr)"
        title="Auto-import"
        subtitle={subtitle}
        action={
          admin && s ? (
            <Switch checked={enabled} disabled={update.isPending} onChange={(v) => update.mutate({ enabled: v })} label={enabled ? 'Turn off auto-import' : 'Turn on auto-import'} />
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {admin && s && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-3">
              Check every
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
              <Button size="sm" disabled={busy} onClick={() => void go({ dryRun: true })} title="Show what would be imported without changing anything">
                <Eye className="size-3.5" /> Preview
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void go({})}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Run now
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
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">Waiting for import · {stuck.length}</h3>
            <ul className="divide-y divide-line">
              {stuck.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{i.title}{i.subtitle ? <span className="text-ink-3"> · {i.subtitle}</span> : null}</div>
                    <div className="truncate text-[11px] text-warn" title={i.warnings.join('\n')}>{i.warnings[0] ?? i.errorMessage ?? 'Import needs attention'}</div>
                  </div>
                  {admin && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void go({ queueId: i.id })}>
                      Try import
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
              Preview — nothing was changed
              <button type="button" className="ml-auto font-normal normal-case tracking-normal hover:text-ink-2" onClick={() => setPreview(undefined)}>Dismiss</button>
            </h3>
            {preview.length ? (
              <ul className="divide-y divide-line">{preview.map((e) => <Entry key={e.id} e={e} />)}</ul>
            ) : (
              <p className="text-xs text-ink-3">Nothing is waiting to be imported.</p>
            )}
          </div>
        )}

        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
            Recent activity{s?.lastRun ? ` · last checked ${relative(s.lastRun)}` : ''}
          </h3>
          {s?.log.length ? (
            <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">{s.log.map((e) => <Entry key={e.id} e={e} />)}</ul>
          ) : (
            <EmptyState icon={Wand2} title="Nothing imported yet" description="Downloads Sonarr can’t match on its own will show up here." />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

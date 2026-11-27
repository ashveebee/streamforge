import { useState } from 'react';
import { Eye, LoaderCircle, Play, Recycle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCleanup, useRunCleanup, useUpdateCleanup } from '@/hooks/queries';
import { relative } from '@/lib/format';
import type { CleanupAction, CleanupEntry } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { EmptyState } from '@/components/ui/States';
import { t, type MessageKey } from '@/i18n';

const ACTION_LABEL: Record<CleanupAction, MessageKey> = {
  'blocklist-search': 'widgets.queue.blocklistSearch',
  blocklist: 'widgets.cleanup.blocklistOnly',
  remove: 'widgets.cleanup.removeOnly',
};

const selectCls =
  'h-8 rounded-lg border border-line-strong bg-surface-2 px-2 text-xs text-ink outline-none focus:border-brand/60 disabled:opacity-50';

function Row({ e }: { e: CleanupEntry }) {
  const tone = e.outcome === 'done' ? 'ok' : e.outcome === 'failed' ? 'bad' : 'brand';
  const label = e.outcome === 'done' ? t('widgets.cleanup.removed') : e.outcome === 'failed' ? t('widgets.requests.failed') : t('widgets.cleanup.wouldRemove');
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Pill tone={tone} className="mt-0.5 shrink-0">{label}</Pill>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{e.title}</div>
        <div className="truncate text-[11px] text-ink-3" title={e.release}>
          {e.instanceName} · {e.reason}{e.error ? ` · ${e.error}` : ''}
        </div>
      </div>
      {e.outcome !== 'preview' && <span className="shrink-0 text-[11px] text-ink-4">{relative(e.at)}</span>}
    </li>
  );
}

/** Settings and history for removing stalled/failed downloads. */
export function CleanupCard() {
  const { user } = useAuth();
  const admin = !!user?.isAdmin;
  const q = useCleanup();
  const update = useUpdateCleanup();
  const run = useRunCleanup();
  const [preview, setPreview] = useState<CleanupEntry[]>();
  const s = q.data;
  if (s && !s.available) return null;
  const on = !!s?.settings.enabled;
  const busy = update.isPending || run.isPending;

  const go = async (dryRun: boolean) => {
    const r = await run.mutateAsync(dryRun).catch(() => undefined);
    if (r) setPreview(dryRun ? r.results : undefined);
  };

  return (
    <Card>
      <CardHeader
        icon={Recycle}
        title={t('widgets.cleanup.title')}
        subtitle={
          !s
            ? t('widgets.cleanup.about')
            : on
              ? `${t('widgets.cleanup.on')} · ${s.pending ? t('widgets.cleanup.pending', { count: s.pending }) : t('widgets.cleanup.nothing')} · ${t('widgets.cleanup.watching', { count: s.watching })}`
              : `${t('widgets.cleanup.off')} · ${t('widgets.cleanup.about')}`
        }
        action={admin && s ? <Switch checked={on} disabled={busy} onChange={(v) => update.mutate({ enabled: v })} label={on ? t('widgets.cleanup.turnOff') : t('widgets.cleanup.turnOn')} /> : undefined}
      />
      <CardBody className="space-y-4">
        {admin && s && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-3">
            <label className="flex items-center gap-2">
              {t('widgets.cleanup.after')}
              <select className={selectCls} value={s.settings.stalledHours} disabled={busy} onChange={(e) => update.mutate({ stalledHours: Number(e.target.value) })}>
                {s.stallHours.map((h) => <option key={h} value={h}>{t('widgets.cleanup.hours', { n: h })}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              {t('widgets.cleanup.then')}
              <select className={selectCls} value={s.settings.action} disabled={busy} onChange={(e) => update.mutate({ action: e.target.value as CleanupAction })}>
                {s.actions.map((a) => <option key={a} value={a}>{t(ACTION_LABEL[a])}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={s.settings.failed} disabled={busy} onChange={(v) => update.mutate({ failed: v })} label={t('widgets.cleanup.failedLabel')} />
              {t('widgets.cleanup.failed')}
            </label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void go(true)}><Eye className="size-3.5" /> {t('widgets.cleanup.preview')}</Button>
              <Button size="sm" variant="primary" disabled={busy || !on} onClick={() => void go(false)} title={on ? undefined : t('widgets.cleanup.onFirst')}>
                {run.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {t('widgets.cleanup.run')}
              </Button>
            </div>
          </div>
        )}
        {(run.error || update.error) && (
          <p className="rounded-xl border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad" role="alert">{((run.error ?? update.error) as Error).message}</p>
        )}
        {preview && (
          <div>
            <h3 className="mb-1 flex text-[11px] font-semibold tracking-wide text-ink-4 uppercase">
              {t('widgets.cleanup.previewTitle')}
              <button type="button" className="ml-auto font-normal tracking-normal normal-case hover:text-ink-2" onClick={() => setPreview(undefined)}>{t('widgets.cleanup.dismiss')}</button>
            </h3>
            {preview.length ? <ul className="divide-y divide-line">{preview.map((e) => <Row key={e.id} e={e} />)}</ul> : <p className="text-xs text-ink-3">{t('widgets.cleanup.clear')}</p>}
          </div>
        )}
        <div>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{t('widgets.cleanup.recent')}{s?.lastRun ? ` · ${t('widgets.cleanup.lastChecked', { when: relative(s.lastRun) })}` : ''}</h3>
          {s?.log.length ? (
            <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">{s.log.map((e) => <Row key={e.id} e={e} />)}</ul>
          ) : (
            <EmptyState icon={Recycle} title={t('widgets.cleanup.none')} description={t('widgets.cleanup.noneHint')} />
          )}
        </div>
        <p className="text-[11px] text-ink-4">
          {t('widgets.cleanup.note')}
        </p>
      </CardBody>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { useMainServer } from '@/hooks/queries';
import { BellRing, LoaderCircle, Save } from 'lucide-react';
import { useGuard, useSaveGuard, type GuardSettings } from '@/hooks/useServices';
import { relative } from '@/lib/format';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Input, Select } from '../ui/Input';
import { Switch } from '../ui/Switch';
import { t } from '@/i18n';

/** Transcode and bandwidth alerts (admins). */
export function PlaybackGuardCard() {
  const main = useMainServer();
  const q = useGuard(true);
  const save = useSaveGuard();
  const [form, setForm] = useState<GuardSettings | undefined>();
  useEffect(() => {
    if (q.data && !form) setForm(q.data.settings);
  }, [q.data, form]);
  if (!q.data || !form) return null;
  const d = q.data;
  const dirty = JSON.stringify(form) !== JSON.stringify(d.settings);
  const set = <K extends keyof GuardSettings>(k: K, v: GuardSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return (
    <Card>
      <CardHeader
        icon={BellRing}
        accent="var(--color-warn)"
        title={t('widgets.guard.title')}
        subtitle={d.last.error ?? (d.last.at ? t('widgets.guard.now', { count: d.last.transcodes, mbps: d.last.mbps, when: relative(d.last.at) }) : t('widgets.guard.every'))}
        action={<Switch checked={d.settings.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ enabled: v }, { onSuccess: (r) => setForm(r.settings) })} label={t('widgets.guard.toggle')} />}
      />
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form, { onSuccess: (r) => setForm(r.settings) });
          }}
        >
          <label className="text-xs text-ink-3">
            {t('widgets.guard.maxTranscodes')}
            <Input className="mt-1 h-9" type="number" min={0} max={50} value={form.maxTranscodes} onChange={(e) => set('maxTranscodes', Number(e.target.value))} />
            <span className="text-[11px] text-ink-4">{t('widgets.guard.zeroOff')}</span>
          </label>
          <label className="text-xs text-ink-3">
            {t('widgets.guard.maxMbps')}
            <Input className="mt-1 h-9" type="number" min={0} value={form.maxMbps} onChange={(e) => set('maxMbps', Number(e.target.value))} />
            <span className="text-[11px] text-ink-4">{t('widgets.guard.mbpsHint')}</span>
          </label>
          <label className="text-xs text-ink-3">
            {t('widgets.guard.fourK')}
            <Select className="mt-1 h-9" value={form.fourK} onChange={(e) => set('fourK', e.target.value as GuardSettings['fourK'])}>
              <option value="off">{t('widgets.guard.nothing')}</option>
              <option value="alert">{t('widgets.guard.alert')}</option>
              <option value="message">{t('widgets.guard.alertMessage')}</option>
            </Select>
          </label>
          {form.fourK === 'message' && (
            <label className="text-xs text-ink-3 sm:col-span-3">
              {t('widgets.guard.message')}
              <Input className="mt-1 h-9" maxLength={400} value={form.message} onChange={(e) => set('message', e.target.value)} />
            </label>
          )}
          <div className="flex items-center gap-2 sm:col-span-3">
            <p className="mr-auto text-[11px] text-ink-4">{t('widgets.guard.where')}{main.plex ? ` ${t('widgets.guard.plex')}` : main.emby ? '' : ` ${t('widgets.guard.needsKey')}`}</p>
            {save.error && <span className="text-xs text-bad">{(save.error as Error).message}</span>}
            <Button size="sm" variant="primary" type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {t('common.save')}
            </Button>
          </div>
        </form>
        {d.recent.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-1 text-xs font-medium text-ink-2">{t('widgets.guard.recent')}</div>
            <ul className="space-y-1">
              {d.recent.slice(0, 5).map((a, i) => (
                <li key={i} className="text-[11px] text-ink-3"><span className="text-ink-4">{relative(a.at)}</span> · {a.message}</li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

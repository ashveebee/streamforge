import { useEffect, useState, type FormEvent } from 'react';
import { Bell, BellOff, BellRing, CircleCheck, CircleX, Link2, LoaderCircle, Plus, Save, Send, Smartphone, Trash2 } from 'lucide-react';
import { useNotifications, useRemoveChannel, useSaveChannel, useSavePublicUrl, useTestChannel } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/format';
import { isSubscribed, pushSupport, subscribe, unsubscribe } from '@/lib/push';
import type { ChannelType, NotificationsStatus, NotifyChannel, NotifyEvent } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { t } from '@/i18n';

const inputCls =
  'h-9 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 transition outline-none focus:border-brand/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand/10 aria-[invalid=true]:border-bad/60';

const EVENTS = ['service_down', 'service_up', 'disk_low', 'import_done', 'import_failed', 'download_removed', 'request_pending', 'playback_alert', 'weekly_digest', 'update_available', 'kometa_error', 'kometa_run', 'rule'] as const;
export const eventLabel = (e: NotifyEvent) => ((EVENTS as readonly string[]).includes(e) ? t(`sec.notify.event.${e as (typeof EVENTS)[number]}`) : e);

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  optional?: boolean;
  help?: string;
}

const TYPES: Record<Exclude<ChannelType, 'webpush'>, { label: string; fields: FieldDef[] }> = {
  discord: {
    label: 'Discord',
    fields: [{ key: 'webhookUrl', get label() { return t('sec.notify.webhookUrl'); }, secret: true, placeholder: 'https://discord.com/api/webhooks/…', get help() { return t('sec.notify.discordHelp'); } }],
  },
  ntfy: {
    label: 'ntfy',
    fields: [
      { key: 'server', get label() { return t('svc.server.server'); }, placeholder: 'https://ntfy.sh', optional: true },
      { key: 'topic', get label() { return t('sec.notify.topic'); }, placeholder: 'streamforge-alerts' },
      { key: 'token', get label() { return t('sec.notify.token'); }, secret: true, optional: true, get help() { return t('sec.notify.tokenHelp'); } },
    ],
  },
  pushover: {
    label: 'Pushover',
    fields: [
      { key: 'userKey', get label() { return t('sec.notify.userKey'); }, secret: true },
      { key: 'appToken', get label() { return t('sec.notify.appToken'); }, secret: true, get help() { return t('sec.notify.appTokenHelp'); } },
    ],
  },
  webhook: {
    label: 'Webhook',
    fields: [
      { key: 'url', label: 'URL', placeholder: 'https://example.com/hooks/streamforge' },
      { key: 'secret', get label() { return t('sec.notify.signing'); }, secret: true, optional: true, get help() { return t('sec.notify.signingHelp'); } },
    ],
  },
};

function EventPicker({ value, events, onChange }: { value: NotifyEvent[]; events: NotifyEvent[]; onChange: (v: NotifyEvent[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('sec.notify.events')}>
      {events.map((e) => {
        const on = value.includes(e);
        return (
          <button
            key={e}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== e) : [...value, e])}
            className={cn(
              'rounded-lg border px-2 py-1 text-[11px] transition',
              on ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2',
            )}
          >
            {eventLabel(e)}
          </button>
        );
      })}
    </div>
  );
}

function ChannelEditor({ ch, type, status, onDone }: { ch?: NotifyChannel; type: ChannelType; status: NotificationsStatus; onDone?: () => void }) {
  const def = type === 'webpush' ? { label: 'Push', fields: [] } : TYPES[type];
  const init = () => ({
    name: ch?.name ?? def.label,
    events: ch?.events ?? status.defaultEvents,
    config: Object.fromEntries(def.fields.map((f) => [f.key, f.secret ? '' : (ch?.config[f.key] ?? '')])),
  });
  const [form, setForm] = useState(init);
  useEffect(() => setForm(init()), [ch]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSaveChannel();
  const test = useTestChannel();
  const remove = useRemoveChannel();
  const err = save.error instanceof ApiError ? save.error : undefined;
  const busy = save.isPending || test.isPending || remove.isPending;

  const payload = (enabled = ch?.enabled ?? true) => ({
    id: ch?.id,
    type,
    name: form.name,
    enabled,
    events: form.events,
    // Blank secret fields are left out so the saved value is kept.
    config: Object.fromEntries(Object.entries(form.config).filter(([k, v]) => v || !def.fields.find((f) => f.key === k)?.secret)),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(payload()).catch(() => undefined);
    if (r && !ch) onDone?.();
  }

  const testResult = test.data as { ok: boolean; message?: string } | undefined;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="brand">{type === 'webpush' ? 'Push' : def.label}</Pill>
        <input aria-label={t('sec.notify.name')} className={cn(inputCls, 'h-8 max-w-60 text-[13px]')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {ch && (
          <div className="ml-auto flex items-center gap-2">
            <Switch checked={ch.enabled} disabled={busy} onChange={(v) => save.mutate(payload(v))} label={ch.enabled ? t('sec.notify.pause', { name: ch.name }) : t('sec.notify.resume', { name: ch.name })} />
          </div>
        )}
      </div>
      {def.fields.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {def.fields.map((f) => {
            const fieldErr = err?.field === `config.${f.key}` ? err.message : undefined;
            const saved = ch?.secrets[f.key];
            return (
              <label key={f.key} className="block text-xs text-ink-2">
                <span className="mb-1 block font-medium">{f.label}{f.optional ? <span className="text-ink-4"> ({t('common.optional').toLocaleLowerCase()})</span> : null}</span>
                <input
                  className={cn(inputCls, f.secret && 'font-mono text-[13px]')}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  spellCheck={false}
                  placeholder={f.secret && saved ? t('sec.savedHint', { hint: saved }) : f.placeholder}
                  value={form.config[f.key] ?? ''}
                  aria-invalid={!!fieldErr}
                  onChange={(e) => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })}
                />
                {fieldErr ? <span className="mt-1 block text-bad">{fieldErr}</span> : f.help && <span className="mt-1 block text-[11px] text-ink-4">{f.help}</span>}
              </label>
            );
          })}
        </div>
      )}
      <EventPicker value={form.events} events={status.events} onChange={(events) => setForm({ ...form, events })} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto text-xs">
          {err && !err.field?.startsWith('config.') ? (
            <span className="text-bad">{err.message}</span>
          ) : testResult ? (
            testResult.ok ? (
              <span className="inline-flex items-center gap-1 text-ok"><CircleCheck className="size-3.5" /> {t('sec.notify.testSent')}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-bad"><CircleX className="size-3.5" /> {testResult.message}</span>
            )
          ) : null}
        </div>
        {ch ? (
          <>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => confirm(t('sec.notify.confirmDelete', { name: ch.name })) && remove.mutate(ch.id)}>
              <Trash2 className="size-3.5" /> {t('widgets.everyone.delete')}
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => test.mutate(ch.id)} title={t('sec.notify.saveFirst')}>
              {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} {t('sec.notify.sendTest')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>{t('media.cancel')}</Button>
        )}
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {ch ? t('common.save') : t('admin.setup.add')}
        </Button>
      </div>
    </form>
  );
}

function ThisDevice({ status }: { status: NotificationsStatus }) {
  const support = pushSupport();
  const [on, setOn] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (support.ok) isSubscribed().then(setOn, () => setOn(false));
  }, [support.ok]);

  const toggle = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (on) await unsubscribe();
      else await subscribe(status.push.publicKey);
      setOn(!on);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-4">
      <span className="grid size-8 place-items-center rounded-lg border border-line bg-white/[0.03]"><Smartphone className="size-4 text-ink-2" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{t('sec.notify.push')}</div>
        <div className="text-[11px] text-ink-4">
          {support.ok ? t('sec.notify.devices', { count: status.push.devices }) : support.reason}
        </div>
        {error && <div className="mt-1 text-[11px] text-bad">{error}</div>}
      </div>
      {support.ok && (
        <Button size="sm" variant={on ? 'outline' : 'primary'} disabled={busy || on === undefined} onClick={() => void toggle()}>
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : on ? <BellOff className="size-3.5" /> : <BellRing className="size-3.5" />}
          {on ? t('sec.notify.offHere') : t('sec.notify.onHere')}
        </Button>
      )}
    </div>
  );
}

function PublicUrl({ value }: { value: string }) {
  const [url, setUrl] = useState(value);
  useEffect(() => setUrl(value || window.location.origin), [value]);
  const save = useSavePublicUrl();
  return (
    <form
      className="flex flex-wrap items-end gap-2 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(url.trim());
      }}
    >
      <label className="min-w-60 flex-1 text-xs text-ink-2">
        <span className="mb-1 flex items-center gap-1.5 font-medium"><Link2 className="size-3.5" /> {t('sec.notify.address')}</span>
        <input className={inputCls} type="url" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://streamforge.example.com" />
        <span className="mt-1 block text-[11px] text-ink-4">
          {save.error ? <span className="text-bad">{(save.error as Error).message}</span> : t('sec.notify.addressHint')}
        </span>
      </label>
      <Button type="submit" size="sm" disabled={save.isPending || url.trim() === value}>{t('common.save')}</Button>
    </form>
  );
}

export function NotificationsSection() {
  const q = useNotifications();
  const [adding, setAdding] = useState<ChannelType>();
  const s = q.data;
  if (!s) return null;
  const hasPush = s.channels.some((c) => c.type === 'webpush');
  return (
    <section className="mt-8" aria-labelledby="notify-h">
      <div className="mb-3 flex items-end gap-3">
        <div className="flex-1">
          <h2 id="notify-h" className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Bell className="size-4 text-brand" /> {t('settings.tabs.notifications.label')}</h2>
          <p className="text-xs text-ink-3">{t('sec.notify.intro')}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <Plus className="size-3.5" />
          <select
            aria-label={t('sec.notify.add')}
            className="h-8 rounded-lg border border-line-strong bg-surface-2 px-2 text-xs text-ink outline-none"
            value=""
            onChange={(e) => setAdding(e.target.value as ChannelType)}
          >
            <option value="" disabled>{t('sec.notify.addOption')}</option>
            {(Object.keys(TYPES) as (keyof typeof TYPES)[]).map((k) => <option key={k} value={k}>{TYPES[k].label}</option>)}
          </select>
        </label>
      </div>
      <Card>
        <div className="divide-y divide-line">
          <ThisDevice status={s} />
          {s.channels.map((c) => (hasPush || c.type !== 'webpush') && <ChannelEditor key={c.id} ch={c} type={c.type} status={s} />)}
          {adding && <ChannelEditor key={`new-${adding}`} type={adding} status={s} onDone={() => setAdding(undefined)} />}
          {!s.channels.length && !adding && (
            <p className="px-5 py-4 text-xs text-ink-3">{t('sec.notify.none')}</p>
          )}
          <PublicUrl value={s.publicUrl} />
          {s.deliveries.length > 0 && (
            <details className="px-5 py-3">
              <summary className="cursor-pointer text-xs text-ink-3">{t('sec.notify.deliveries')}</summary>
              <ul className="mt-2 space-y-1">
                {s.deliveries.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    {d.ok ? <CircleCheck className="size-3 shrink-0 text-ok" /> : <CircleX className="size-3 shrink-0 text-bad" />}
                    <span className="truncate text-ink-2">{d.title}</span>
                    <span className="truncate text-ink-4">→ {d.channel}{d.error ? `: ${d.error}` : ''}</span>
                    <span className="ml-auto shrink-0 text-ink-4">{relative(d.at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>
    </section>
  );
}

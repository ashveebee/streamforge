import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, KeyRound, LoaderCircle, PlugZap, Save } from 'lucide-react';
import { useMediaServerSettings, useSaveMediaServer, useTestMediaServer } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { MediaServerType, MediaServerView } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { ServiceIcon } from '@/components/ui/ServiceIcon';
import { inputCls } from '@/components/ui/Input';
import { t } from '@/i18n';

export const SERVER_TYPE_NAMES: Record<MediaServerType, string> = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex', silo: 'Silo' };

/** Per-type wording: default port, key name and where to find it. */
const TYPE_HELP: Record<'plex' | 'emby' | 'silo', { placeholder: string; key: string; hint: string; intro: string }> = {
  emby: {
    placeholder: 'http://192.168.1.20:8096',
    get key() { return t('settings.service.apiKey'); },
    get hint() { return t('sec.main.embyHint'); },
    get intro() { return t('sec.main.embyIntro'); },
  },
  plex: {
    placeholder: 'http://192.168.1.20:32400',
    get key() { return t('sec.main.plexToken'); },
    get hint() { return t('sec.main.plexHint'); },
    get intro() { return t('sec.main.plexIntro'); },
  },
  silo: {
    placeholder: 'http://192.168.1.20:8090',
    get key() { return t('settings.service.apiKey'); },
    get hint() { return t('sec.main.siloHint'); },
    get intro() { return t('sec.main.siloIntro'); },
  },
};

function ServerForm({ srv }: { srv: MediaServerView }) {
  const type = srv.type === 'emby' || srv.type === 'silo' ? srv.type : 'plex';
  const help = TYPE_HELP[type];
  const blank = { name: srv.name, url: srv.url, publicUrl: srv.publicUrl ?? '', apiKey: '' };
  const [form, setForm] = useState(blank);
  const test = useTestMediaServer();
  const save = useSaveMediaServer();
  useEffect(() => setForm({ name: srv.name, url: srv.url, publicUrl: srv.publicUrl ?? '', apiKey: '' }), [srv.name, srv.url, srv.publicUrl]);

  const dirty = form.name !== blank.name || form.url !== blank.url || form.publicUrl !== blank.publicUrl || !!form.apiKey;
  const err = save.error instanceof ApiError ? save.error : undefined;
  const busy = test.isPending || save.isPending;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    test.reset();
    save.reset();
  };
  const input = () => ({ id: srv.id, name: form.name.trim(), url: form.url.trim(), publicUrl: form.publicUrl.trim(), apiKey: form.apiKey.trim() || undefined });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(input()).catch(() => undefined);
    if (r) setForm((f) => ({ ...f, apiKey: '' }));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-line px-5 py-4">
      <div className="grid gap-3 md:grid-cols-[minmax(120px,0.7fr)_minmax(180px,1.3fr)_minmax(180px,1fr)]">
        <input aria-label={t('sec.main.name')} className={cn(inputCls, 'h-9')} placeholder={t('kometa.form.name')} value={form.name} aria-invalid={err?.field === 'name'} onChange={(e) => set('name', e.target.value)} />
        <input
          aria-label={t('settings.service.address')}
          className={cn(inputCls, 'h-9')}
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder={help.placeholder}
          value={form.url}
          aria-invalid={err?.field === 'url'}
          onChange={(e) => set('url', e.target.value)}
        />
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
          <input
            aria-label={help.key}
            className={cn(inputCls, 'h-9 pl-8 font-mono text-[13px]')}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={srv.apiKeySet ? t('sec.savedHint', { hint: srv.apiKeyHint ?? '••••' }) : help.key}
            value={form.apiKey}
            aria-invalid={err?.field === 'apiKey'}
            onChange={(e) => set('apiKey', e.target.value)}
          />
        </div>
      </div>
      <input
        aria-label={t('settings.service.publicAddress')}
        className={cn(inputCls, 'h-9')}
        type="url"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        placeholder={t('sec.main.publicPh')}
        value={form.publicUrl}
        aria-invalid={err?.field === 'publicUrl'}
        onChange={(e) => set('publicUrl', e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 text-xs">
          {err ? (
            <span className="text-bad" role="alert">{err.message}</span>
          ) : test.data ? (
            test.data.ok ? (
              <span className="inline-flex items-center gap-1 text-ok"><CircleCheck className="size-3.5" /> {t('settings.service.connected')}{test.data.version ? ` · v${test.data.version}` : ''}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-bad"><CircleX className="size-3.5" /> {test.data.message}</span>
            )
          ) : (
            <span className="text-ink-4">{help.hint}</span>
          )}
        </div>
        <Button type="button" size="sm" disabled={busy || !form.url.trim()} onClick={() => test.mutate(input())}>
          {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          {t('sec.sso.test')}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty}>
          {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

/** Says the media server is fixed, and mentions servers an earlier version watched that are now ignored. */
export function MediaServerNote({ type }: { type: MediaServerType }) {
  const q = useMediaServerSettings();
  const ignored = q.data?.ignored ?? [];
  return (
    <p className="px-1 text-[11px] leading-relaxed text-ink-4">
      {t('sec.main.note', { server: SERVER_TYPE_NAMES[type] })}
      {ignored.length > 0 && (
        <> {ignored.length === 1 ? t('sec.main.ignoredOne', { name: ignored[0]!.name, type: SERVER_TYPE_NAMES[ignored[0]!.type] }) : t('sec.main.ignoredMany', { count: ignored.length })}</>
      )}
    </p>
  );
}

/** The Plex or Emby server chosen at setup: its address and token can change, the server type can't. */
export function MainServerSection({ type }: { type: 'plex' | 'emby' | 'silo' }) {
  const q = useMediaServerSettings();
  const srv = q.data?.servers[0];
  return (
    <li className="space-y-2">
      <Card>
        <header className="flex flex-wrap items-center gap-3 p-5">
          <ServiceIcon id={type} size={40} />
          <div className="min-w-[12rem] flex-1">
            <h3 className="text-[15px] font-semibold">{SERVER_TYPE_NAMES[type]}</h3>
            <p className="text-[11px] text-ink-4">{TYPE_HELP[type].intro}</p>
          </div>
          <Pill tone="brand">{t('sec.main.yours')}</Pill>
        </header>
        {srv ? <ServerForm srv={srv} /> : <p className="border-t border-line px-5 py-4 text-xs text-ink-4">{q.isError ? t('sec.main.loadError') : `${t('common.loading')}…`}</p>}
      </Card>
      <MediaServerNote type={type} />
    </li>
  );
}

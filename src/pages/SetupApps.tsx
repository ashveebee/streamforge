import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Check, CircleCheck, CircleX, ExternalLink, KeyRound, LoaderCircle, PlugZap, Radar, Sparkles } from 'lucide-react';
import {
  useDiscoverApps,
  useFinishSetup,
  useImportApps,
  useMainServer,
  useSaveService,
  useServiceSettings,
  useTestService,
  type FoundApp,
  type ImportableApp,
  type SetupAppId,
} from '@/hooks/queries';
import { cn } from '@/lib/cn';
import type { ServiceSettingsView } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { inputCls } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { MEDIA_SERVERS, SERVICES, ServiceIcon } from '@/components/ui/ServiceIcon';
import { getLocale, t } from '@/i18n';

/*
 * First-run setup, step 2: the apps around the media server. Step 1 (the
 * media server itself) happens on the sign-in page before anyone can sign in.
 */

/** Most useful first; the rest are for people who run them. */
const APPS: SetupAppId[] = ['sonarr', 'radarr', 'seerr', 'prowlarr', 'bazarr', 'lidarr', 'readarr'];
const OPTIONAL = new Set<SetupAppId>(['bazarr', 'lidarr', 'readarr']);

/** Where each app shows its API key, relative to its address. */
const KEY_PAGE: Record<SetupAppId, { path: string; where: string }> = {
  sonarr: { path: '/settings/general', where: 'Settings → General → Security' },
  radarr: { path: '/settings/general', where: 'Settings → General → Security' },
  prowlarr: { path: '/settings/general', where: 'Settings → General → Security' },
  lidarr: { path: '/settings/general', where: 'Settings → General → Security' },
  readarr: { path: '/settings/general', where: 'Settings → General → Security' },
  bazarr: { path: '/settings/general', where: 'Settings → General → Security' },
  seerr: { path: '/settings', where: 'Settings → General → API Key' },
};

const PLACEHOLDER: Record<SetupAppId, string> = {
  sonarr: 'http://192.168.1.20:8989',
  radarr: 'http://192.168.1.20:7878',
  prowlarr: 'http://192.168.1.20:9696',
  seerr: 'http://192.168.1.20:5055',
  bazarr: 'http://192.168.1.20:6767',
  lidarr: 'http://192.168.1.20:8686',
  readarr: 'http://192.168.1.20:8787',
};

const VIA = (v: FoundApp['via']) => t(`admin.setup.via.${v}`);

function Stepper({ step }: { step: 1 | 2 }) {
  const main = useMainServer();
  const items = [
    { n: 1, label: t('settings.groups.media.title'), detail: main.name },
    { n: 2, label: t('admin.setup.yourApps'), detail: 'Sonarr, Radarr, Seerr…' },
  ];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {items.map((it, i) => {
        const done = it.n < step;
        const current = it.n === step;
        return (
          <li key={it.n} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-line-strong" aria-hidden />}
            <span
              className={cn(
                'grid size-6 place-items-center rounded-full border text-[11px] font-semibold',
                done ? 'border-ok/50 bg-ok/15 text-ok' : current ? 'border-brand/60 bg-brand/15 text-ink' : 'border-line-strong text-ink-4',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} /> : it.n}
            </span>
            <span className={cn('font-medium', current ? 'text-ink' : 'text-ink-3')}>
              {it.label}
              <span className="ml-1 font-normal text-ink-4">· {it.detail}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function AppCard({ id, s, found, scanning }: { id: SetupAppId; s?: ServiceSettingsView; found?: FoundApp; scanning: boolean }) {
  const meta = SERVICES[id];
  const connected = !!s?.configured;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(s?.url || found?.url || '');
  const [apiKey, setApiKey] = useState('');
  const test = useTestService(id);
  const save = useSaveService(id);
  // Fill in the address once discovery finds it, unless something's been typed.
  useEffect(() => {
    if (found?.url && !url) setUrl(found.url);
  }, [found?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (found && !connected) setOpen(true);
  }, [found, connected]);

  const busy = test.isPending || save.isPending;
  const result = test.data;
  const keyPage = (() => {
    try {
      return url ? new URL(KEY_PAGE[id].path, url.endsWith('/') ? url : `${url}/`).toString() : undefined;
    } catch {
      return undefined;
    }
  })();

  async function connect(e: FormEvent) {
    e.preventDefault();
    const input = { url: url.trim(), apiKey: apiKey.trim() };
    const t = await test.mutateAsync(input).catch(() => undefined);
    if (t?.ok) {
      await save.mutateAsync(input).catch(() => undefined);
      setApiKey('');
      setOpen(false);
    }
  }

  return (
    <li>
      <Card className={cn('overflow-hidden transition', connected && 'border-ok/25')}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <ServiceIcon id={id} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold">{found?.name && found.service === 'seerr' ? found.name : meta.name}</span>
              <span className="text-[11px] text-ink-4">{meta.tagline}</span>
              {OPTIONAL.has(id) && !connected && !found && <span className="text-[11px] text-ink-4">· {t('admin.setup.optional')}</span>}
            </div>
            <div className="mt-0.5 truncate text-[11px]">
              {connected ? (
                <span className="text-ok">{t('settings.service.connected')} · {s!.url}</span>
              ) : found ? (
                <span className="text-ink-2">
                  {t('admin.setup.found', { where: VIA(found.via) })} · <span className="font-mono">{found.url}</span>
                </span>
              ) : scanning ? (
                <span className="text-ink-4">{t('admin.setup.looking')}</span>
              ) : (
                <span className="text-ink-4">{t('admin.setup.notFound')}</span>
              )}
            </div>
          </div>
          {connected ? (
            <Pill tone="ok">
              <Check className="size-3" strokeWidth={3} /> {t('settings.service.connected')}
            </Pill>
          ) : (
            <Button size="sm" variant={found && !open ? 'primary' : 'ghost'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? t('media.close') : found ? t('login.connect') : t('admin.setup.add')}
            </Button>
          )}
        </div>
        {open && !connected && (
          <form onSubmit={connect} className="space-y-3 border-t border-line bg-white/[0.015] p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-ink-3">{t('admin.setup.address')}</span>
                <input
                  className={cn(inputCls, 'h-9 font-mono text-[13px]')}
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={PLACEHOLDER[id]}
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    test.reset();
                  }}
                  required
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] text-ink-3">{t('settings.service.apiKey')}</span>
                <span className="relative block">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
                  <input
                    className={cn(inputCls, 'h-9 pl-8 font-mono text-[13px]')}
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder={t('settings.service.pasteKey')}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      test.reset();
                    }}
                    required
                  />
                </span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="mr-auto min-w-0 text-xs">
                {result && !result.ok ? (
                  <span className="inline-flex items-center gap-1 text-bad" role="alert">
                    <CircleX className="size-3.5 shrink-0" /> {result.message}
                  </span>
                ) : save.error ? (
                  <span className="text-bad" role="alert">{(save.error as Error).message}</span>
                ) : (
                  <span className="text-ink-4">
                    {t('admin.setup.findKey', { app: meta.name, where: KEY_PAGE[id].where })}
                    {keyPage && (
                      <>
                        {' · '}
                        <a href={keyPage} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                          {t('admin.setup.openIt')} <ExternalLink className="size-3" />
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={busy || !url.trim() || !apiKey.trim()}>
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                {test.isPending ? t('admin.setup.testing') : save.isPending ? t('admin.setup.saving') : t('admin.setup.testConnect')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </li>
  );
}

/** "Seerr already knows your Sonarr and Radarr": connects them without copying keys. */
function ImportBanner({ items, onDone }: { items: ImportableApp[]; onDone: () => void }) {
  const imp = useImportApps();
  if (!items.length && !imp.data) return null;
  const byFrom = new Map<string, SetupAppId[]>();
  for (const i of items) byFrom.set(i.from, [...(byFrom.get(i.from) ?? []), i.service]);
  const names = (ids: SetupAppId[]) => new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(ids.map((i) => SERVICES[i].name));
  return (
    <Card className="border-brand/30 bg-brand/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 text-[13px]">
          {imp.data ? (
            <ul className="space-y-0.5">
              {imp.data.results.map((r) => (
                <li key={r.service} className={cn('flex items-center gap-1.5', r.ok ? 'text-ok' : 'text-bad')}>
                  {r.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                  {SERVICES[r.service].name}: {r.ok ? t('admin.setup.usingDetails', { app: SERVICES[r.from].name }) : r.message}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {[...byFrom].map(([from, ids]) => (
                <p key={from}>
                  <b className="font-semibold">{SERVICES[from as SetupAppId].name}</b> {t('admin.setup.knows', { count: ids.length, apps: names(ids) })}
                </p>
              ))}
              <p className="mt-0.5 text-[11px] text-ink-3">{t('admin.setup.tested')}</p>
            </>
          )}
        </div>
        {!imp.data && (
          <Button size="sm" variant="primary" disabled={imp.isPending} onClick={() => imp.mutate(undefined, { onSuccess: onDone })}>
            {imp.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {items.length > 1 ? t('admin.setup.connectAll', { count: items.length }) : t('admin.setup.connectOne', { app: SERVICES[items[0]!.service].name })}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function SetupAppsPage() {
  const navigate = useNavigate();
  const main = useMainServer();
  const services = useServiceSettings();
  const discover = useDiscoverApps();
  const finish = useFinishSetup();
  const byId = useMemo(() => new Map((services.data?.services ?? []).map((s) => [s.id, s])), [services.data]);
  const found = useMemo(() => new Map((discover.data?.found ?? []).map((f) => [f.service, f])), [discover.data]);
  // Apps connected since the scan drop out of the import offer.
  const importable = (discover.data?.importable ?? []).filter((i) => !byId.get(i.service)?.configured);
  const connected = APPS.filter((id) => byId.get(id)?.configured).length;

  // Look as soon as the page opens; it takes a few seconds.
  useEffect(() => {
    discover.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => finish.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) });

  return (
    <div className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl text-black" style={{ background: MEDIA_SERVERS[main.type].color }}>
              <Check className="size-5" strokeWidth={3} />
            </span>
            <span className="text-[13px] text-ink-3">
              {t('admin.setup.connected', { server: main.name })} <span className="text-ink-4">{t('admin.setup.watches')}</span>
            </span>
          </div>
          <Stepper step={2} />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('admin.setup.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-ink-3">
              {t('admin.setup.intro', { server: main.name })}
            </p>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          {discover.isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <LoaderCircle className="size-3.5 animate-spin" /> {t('admin.setup.lookingFor')}
            </span>
          ) : discover.data ? (
            <span>
              {t('admin.setup.foundCount', { count: discover.data.found.length })}
              {connected ? ` · ${t('admin.setup.connectedCount', { count: connected })}` : ''}
            </span>
          ) : discover.error ? (
            <span className="text-bad">{(discover.error as Error).message}</span>
          ) : null}
          <Button size="sm" variant="ghost" disabled={discover.isPending} onClick={() => discover.mutate()}>
            <Radar className="size-3.5" /> {t('login.searchAgain')}
          </Button>
        </div>

        <ImportBanner items={importable} onDone={() => discover.mutate()} />

        <ul className="space-y-3">
          {APPS.map((id) => (
            <AppCard key={`${id}:${byId.get(id)?.configured ? 'on' : 'off'}`} id={id} s={byId.get(id)} found={found.get(id)} scanning={discover.isPending} />
          ))}
        </ul>

        {discover.data && discover.data.found.length === 0 && (
          <p className="text-[11px] leading-relaxed text-ink-4">
            {t('admin.setup.nothing')}
          </p>
        )}

        <footer className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <span className="mr-auto text-xs text-ink-4">{finish.error ? <span className="text-bad">{(finish.error as Error).message}</span> : t('admin.setup.switchedOff')}</span>
          <Button variant={connected ? 'primary' : 'ghost'} disabled={finish.isPending} onClick={done}>
            {finish.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {connected ? t('admin.setup.finish') : t('admin.setup.skip')} <ArrowRight className="size-4" />
          </Button>
        </footer>
      </div>
    </div>
  );
}

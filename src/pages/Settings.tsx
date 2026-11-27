import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArchiveRestore,
  Bell,
  ChevronDown,
  ChevronRight,
  Download,
  CircleCheck,
  CircleX,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUpdates } from '@/hooks/useUpdates';
import { useHealth, useMainServer, useResetService, useSaveService, useServiceConfig, useServiceSettings, useSetServiceEnabled, useTestService } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/format';
import type { ConnectionTest, ServiceId, ServiceSettingsInput, ServiceSettingsView } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SERVICES, ServiceIcon } from '@/components/ui/ServiceIcon';
import { Pill, StatusBadge } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { InstancesSection } from '@/components/settings/InstancesSection';
import { MainServerSection, MediaServerNote } from '@/components/settings/MainServerSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { MembersSection } from '@/components/settings/MembersSection';
import { ClientsSection } from '@/components/settings/ClientsSection';
import { BackupSection } from '@/components/settings/BackupSection';
import { SsoSection } from '@/components/settings/SsoSection';
import { MoonfinSection } from '@/components/settings/MoonfinSection';
import { KometaSection } from '@/components/settings/KometaSection';
import { UpdatesSection } from '@/components/settings/UpdatesSection';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { PageLoader } from '@/components/ui/Loader';
import { useT, type MessageKey } from '@/i18n';

/** Where each service keeps its API key, and an example address. */
const HELP: Record<ServiceId, { placeholder: string; keyHelp: MessageKey; keyOptional?: boolean }> = {
  jellyfin: { placeholder: 'https://jellyfin.example.com', keyHelp: 'settings.keyHelp.jellyfin', keyOptional: true },
  sonarr: { placeholder: 'https://sonarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  radarr: { placeholder: 'https://radarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  prowlarr: { placeholder: 'https://prowlarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  seerr: { placeholder: 'https://seerr.example.com', keyHelp: 'settings.keyHelp.seerr' },
  bazarr: { placeholder: 'https://bazarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  lidarr: { placeholder: 'https://lidarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  readarr: { placeholder: 'https://readarr.example.com', keyHelp: 'settings.keyHelp.arr' },
  audiobookshelf: { placeholder: 'https://audiobookshelf.example.com', keyHelp: 'settings.keyHelp.audiobookshelf' },
  infinidisk: { placeholder: 'https://infinidisk.example.com', keyHelp: 'settings.keyHelp.infinidisk', keyOptional: true },
};

/* -------------------------------- inputs -------------------------------- */

const inputCls =
  'h-10 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 transition outline-none focus:border-brand/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand/10 aria-[invalid=true]:border-bad/60';

function Field({ label, htmlFor, help, error, children }: { label: string; htmlFor: string; help?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-2">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-bad" role="alert">{error}</p>
      ) : (
        help && <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">{help}</p>
      )}
    </div>
  );
}

function SourceBadge({ s }: { s: ServiceSettingsView }) {
  const t = useT();
  if (s.source === 'database')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
        <Database className="size-3" /> {t('settings.service.savedHere')}
      </span>
    );
  if (s.source === 'environment')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-ink-3">
        <Server className="size-3" /> {t('settings.service.fromEnv')}
      </span>
    );
  return null;
}

function TestResult({ result }: { result: ConnectionTest }) {
  const t = useT();
  if (!result.ok)
    return (
      <div className="flex items-start gap-2 rounded-xl border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad" role="status">
        <CircleX className="mt-px size-3.5 shrink-0" />
        <span className="break-words">{result.message}</span>
      </div>
    );
  const warnings = result.issues.filter((i) => i.level !== 'info');
  return (
    <div className="space-y-1.5" role="status">
      <div className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok/10 px-3 py-2 text-xs text-ok">
        <CircleCheck className="size-3.5 shrink-0" />
        <span>
          {t('settings.service.connected')}{result.version ? ` · v${result.version}` : ''} · {result.latencyMs} ms
        </span>
      </div>
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 px-1 text-[11px] text-warn">
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ service card ----------------------------- */

interface FormState {
  url: string;
  publicUrl: string;
  apiKey: string;
  clearKey: boolean;
  authHeader: string;
  statusPath: string;
  healthPath: string;
  mounts: string;
}

const initial = (s: ServiceSettingsView): FormState => ({
  url: s.url,
  publicUrl: s.publicUrl ?? '',
  apiKey: '',
  clearKey: false,
  authHeader: s.authHeader ?? '',
  statusPath: s.statusPath ?? '',
  healthPath: s.healthPath ?? '',
  mounts: (s.mounts ?? []).join('\n'),
});

function toInput(id: ServiceId, f: FormState): ServiceSettingsInput {
  const input: ServiceSettingsInput = { url: f.url.trim(), publicUrl: f.publicUrl.trim() };
  if (f.apiKey.trim()) input.apiKey = f.apiKey.trim();
  else if (f.clearKey) input.apiKey = '';
  if (id === 'infinidisk') {
    input.authHeader = f.authHeader.trim();
    input.statusPath = f.statusPath.trim();
    input.healthPath = f.healthPath.trim();
    input.mounts = f.mounts.split('\n').map((m) => m.trim()).filter(Boolean);
  }
  return input;
}

function ServiceCard({ s, index }: { s: ServiceSettingsView; index: number }) {
  const t = useT();
  const meta = SERVICES[s.id];
  const help = HELP[s.id];
  const { logout } = useAuth();
  const health = useHealth();
  const status = health.data?.services.find((h) => h.id === s.id)?.status;

  const [form, setForm] = useState(() => initial(s));
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);
  // Healthy and switched-off services start closed to keep the page short;
  // ones that need attention (switched on but not connected, offline,
  // degraded) start open.
  const [openState, setOpen] = useState<boolean>();
  const open = openState ?? (s.enabled && (!s.configured || status === 'offline' || status === 'degraded'));
  const test = useTestService(s.id);
  const save = useSaveService(s.id);
  const reset = useResetService(s.id);
  const toggle = useSetServiceEnabled(s.id);

  // Pick up server-side changes (after save/reset) without clobbering edits in progress.
  const baseline = useMemo(() => initial(s), [s]);
  useEffect(() => setForm(baseline), [baseline]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
    test.reset();
    save.reset();
  };

  const dirty = (Object.keys(baseline) as (keyof FormState)[]).some((k) => form[k] !== baseline[k]);
  const err = save.error instanceof ApiError ? save.error : test.error instanceof ApiError ? test.error : undefined;
  const fieldError = (field: string) => (err?.field === field ? err.message : undefined);
  const busy = test.isPending || save.isPending || reset.isPending;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(toInput(s.id, form)).catch(() => undefined);
    if (!r) return;
    setSaved(true);
    if (r.signedOut) await logout();
  }

  async function onReset() {
    const r = await reset.mutateAsync().catch(() => undefined);
    if (r?.signedOut) await logout();
  }

  const keyPlaceholder = form.clearKey
    ? t('settings.service.keyRemoved')
    : s.apiKeySet
      ? t('settings.service.keySaved', { hint: s.apiKeyHint ?? '••••' })
      : help.keyOptional
        ? t('common.optional')
        : t('settings.service.pasteKey');

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Card>
        <form onSubmit={onSave} noValidate>
          <header className={cn('flex flex-wrap items-center gap-3 px-5 py-4', open && 'border-b border-line')}>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={`${s.id}-settings`}
              className="flex min-w-[9rem] flex-1 items-center gap-3 text-left"
            >
              <ServiceIcon id={s.id} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tracking-tight">{meta.name}</span>
                <span className="block truncate text-xs text-ink-3">{!open && (s.publicUrl || s.url) ? s.publicUrl || s.url : meta.tagline}</span>
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge s={s} />
              {!s.enabled ? <Pill>{t('settings.service.disabled')}</Pill> : status && <StatusBadge status={status} />}
            </div>
            {s.canDisable && (
              <Switch
                checked={s.enabled}
                disabled={toggle.isPending}
                onChange={(v) => toggle.mutate(v)}
                label={s.enabled ? t('settings.service.disable', { name: meta.name }) : t('settings.service.enable', { name: meta.name })}
                className="ml-1"
              />
            )}
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={`${s.id}-settings`}
              aria-label={open ? t('settings.service.closeSettings', { name: meta.name }) : t('settings.service.openSettings', { name: meta.name })}
              className="grid size-8 place-items-center rounded-lg text-ink-3 transition hover:bg-white/[0.06] hover:text-ink"
            >
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
            </button>
          </header>
          {/* Hidden rather than removed, so edits survive closing the card. */}
          <div id={`${s.id}-settings`} hidden={!open}>
          {!s.enabled && (
            <p className="border-b border-line bg-white/[0.02] px-5 py-2.5 text-xs text-ink-3">
              {t('settings.service.switchedOff')}
            </p>
          )}
          {toggle.error && (
            <p className="border-b border-line px-5 py-2.5 text-xs text-bad" role="alert">{(toggle.error as Error).message}</p>
          )}

          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <Field
              label={t('settings.service.address')}
              htmlFor={`${s.id}-url`}
              error={fieldError('url')}
              help={s.id === 'jellyfin' ? t('settings.service.addressHelpJellyfin') : t('settings.service.addressHelp')}
            >
              <input
                id={`${s.id}-url`}
                className={inputCls}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={help.placeholder}
                value={form.url}
                aria-invalid={!!fieldError('url')}
                onChange={(e) => set('url', e.target.value)}
              />
            </Field>

            <Field
              label={t('settings.service.publicAddress')}
              htmlFor={`${s.id}-public`}
              error={fieldError('publicUrl')}
              help={t(s.id === 'jellyfin' ? 'settings.service.publicHelpJellyfin' : 'settings.service.publicHelp', { name: meta.name })}
            >
              <input
                id={`${s.id}-public`}
                className={inputCls}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={form.url || help.placeholder}
                value={form.publicUrl}
                aria-invalid={!!fieldError('publicUrl')}
                onChange={(e) => set('publicUrl', e.target.value)}
              />
            </Field>

            <Field label={help.keyOptional ? t('settings.service.apiKeyOptional') : t('settings.service.apiKey')} htmlFor={`${s.id}-key`} error={fieldError('apiKey')} help={t(help.keyHelp)}>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
                <input
                  id={`${s.id}-key`}
                  className={cn(inputCls, 'pr-20 pl-8 font-mono text-[13px]')}
                  type={showKey ? 'text' : 'password'}
                  autoComplete="new-password"
                  spellCheck={false}
                  placeholder={keyPlaceholder}
                  value={form.apiKey}
                  disabled={form.clearKey}
                  aria-invalid={!!fieldError('apiKey')}
                  onChange={(e) => set('apiKey', e.target.value)}
                />
                <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
                  {s.apiKeySet && !form.apiKey && (
                    <button
                      type="button"
                      onClick={() => set('clearKey', !form.clearKey)}
                      className="rounded-md px-1.5 py-1 text-[11px] text-ink-4 hover:text-ink-2"
                    >
                      {form.clearKey ? t('settings.service.undo') : t('settings.service.remove')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="grid size-7 place-items-center rounded-md text-ink-4 hover:text-ink-2"
                    aria-label={showKey ? t('settings.service.hideKey') : t('settings.service.showKey')}
                  >
                    {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>
            </Field>

            {s.id === 'infinidisk' && (
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  aria-expanded={advanced}
                  className="flex items-center gap-1.5 text-xs font-medium text-ink-3 hover:text-ink"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', advanced && 'rotate-180')} />
                  {t('settings.service.advanced')}
                </button>
                <AnimatePresence initial={false}>
                  {advanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="grid gap-4 pt-4 md:grid-cols-3">
                        <Field label={t('settings.service.keyHeader')} htmlFor="inf-header" error={fieldError('authHeader')} help={t('settings.service.keyHeaderHelp')}>
                          <input id="inf-header" className={inputCls} spellCheck={false} value={form.authHeader} onChange={(e) => set('authHeader', e.target.value)} />
                        </Field>
                        <Field label={t('settings.service.statusPath')} htmlFor="inf-status" error={fieldError('statusPath')} help={t('settings.service.statusPathHelp')}>
                          <input id="inf-status" className={inputCls} spellCheck={false} placeholder="/api/status" value={form.statusPath} onChange={(e) => set('statusPath', e.target.value)} />
                        </Field>
                        <Field label={t('settings.service.healthPath')} htmlFor="inf-health" error={fieldError('healthPath')} help={t('settings.service.healthPathHelp')}>
                          <input id="inf-health" className={inputCls} spellCheck={false} value={form.healthPath} onChange={(e) => set('healthPath', e.target.value)} />
                        </Field>
                        <div className="md:col-span-3">
                          <Field
                            label={t('settings.service.mounts')}
                            htmlFor="inf-mounts"
                            error={fieldError('mounts')}
                            help={t('settings.service.mountsHelp')}
                          >
                            <textarea
                              id="inf-mounts"
                              rows={2}
                              spellCheck={false}
                              className={cn(inputCls, 'h-auto py-2 font-mono text-[13px]')}
                              placeholder="/mnt/media"
                              value={form.mounts}
                              onChange={(e) => set('mounts', e.target.value)}
                            />
                          </Field>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <AnimatePresence>
              {(test.data || (err && !err.field)) && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="md:col-span-2">
                  {test.data ? (
                    <TestResult result={test.data} />
                  ) : (
                    <TestResult result={{ ok: false, message: err!.message }} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <p className="mr-auto text-[11px] text-ink-4">
              {saved && !dirty ? (
                <span className="text-ok">{t('settings.service.savedApplied')}</span>
              ) : s.source === 'database' && s.updatedAt ? (
                s.updatedBy && s.updatedBy !== 'setup' ? t('settings.service.updatedBy', { when: relative(s.updatedAt), who: s.updatedBy }) : t('settings.service.updated', { when: relative(s.updatedAt) })
              ) : s.source === 'environment' ? (
                t('settings.service.envOverride')
              ) : (
                t('settings.service.notConnected')
              )}
            </p>
            {s.source === 'database' && s.envAvailable && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onReset()} title={t('settings.service.useEnvTitle')}>
                {reset.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                {t('settings.service.useEnv')}
              </Button>
            )}
            <Button type="button" size="sm" disabled={busy || (!form.url.trim() && !form.mounts.trim())} onClick={() => test.mutate(toInput(s.id, form))}>
              {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              {t('settings.service.test')}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty}>
              {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {t('common.save')}
            </Button>
          </footer>
          </div>
        </form>
      </Card>
    </motion.li>
  );
}

/* --------------------------------- page --------------------------------- */

/** Settings is split into pages; each has its own address so links land on it. */
const TABS = [
  { path: '', key: 'services', icon: Server },
  { path: 'downloads', key: 'downloads', icon: Download },
  { path: 'notifications', key: 'notifications', icon: Bell },
  { path: 'access', key: 'access', icon: Users },
  { path: 'system', key: 'system', icon: ArchiveRestore },
] as const;

function SettingsTabs({ update }: { update?: string }) {
  const t = useT();
  return (
    <nav aria-label={t('settings.sections')} className="no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-2xl border border-line bg-white/[0.02] p-1">
        {TABS.map((tab) => (
          <li key={tab.path}>
            <NavLink
              to={tab.path ? `/settings/${tab.path}` : '/settings'}
              end
              className={({ isActive }) =>
                cn(
                  'relative flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                  isActive ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
                )
              }
            >
              <tab.icon className="size-4" />
              {t(`settings.tabs.${tab.key}.label`)}
              {tab.path === 'system' && update && <span className="size-2 rounded-full bg-brand" title={t('nav.updateAvailable', { version: update })} />}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The Services tab, grouped by what each app does. */
const GROUPS = [
  { id: 'media', services: ['jellyfin'] },
  { id: 'library', services: ['sonarr', 'radarr', 'lidarr', 'readarr'] },
  { id: 'audiobooks', services: ['audiobookshelf'] },
  { id: 'indexers', services: ['prowlarr'] },
  { id: 'requests', services: ['seerr'] },
  { id: 'metadata', services: ['bazarr'] },
  { id: 'storage', services: ['infinidisk'] },
] as const satisfies readonly { id: string; services: readonly ServiceId[] }[];

function Group({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`group-${id}`} className="space-y-3">
      <div className="px-1">
        <h2 id={`group-${id}`} className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-ink-4">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ServicesTab() {
  const q = useServiceSettings();
  const main = useMainServer();
  const config = useServiceConfig();
  const t = useT();
  const byId = new Map(q.data?.services.map((s) => [s.id, s]));
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <PageLoader label={t('settings.loading')} />;
  let n = 0;
  return (
    <div className="space-y-9">
      {GROUPS.map((g) => (
        <Group key={g.id} id={g.id} title={t(`settings.groups.${g.id}.title`)} description={t(`settings.groups.${g.id}.description`)}>
          <ul className="space-y-4">
            {g.services.map((id) => {
              const s = byId.get(id);
              if (!s) return null;
              const i = n++;
              return (
                <Fragment key={id}>
                  {/* The media server chosen at setup; it can be edited but not swapped. */}
                  {id === 'jellyfin' && main.other ? (
                    <MainServerSection type={main.type === 'jellyfin' ? 'plex' : main.type} />
                  ) : id === 'jellyfin' ? (
                    <>
                      <ServiceCard s={s} index={i} />
                      <li className="-mt-2">
                        <MediaServerNote type="jellyfin" />
                      </li>
                    </>
                  ) : (
                    <ServiceCard s={s} index={i} />
                  )}
                  {(id === 'sonarr' || id === 'radarr') && s.enabled && <InstancesSection kind={id} />}
                </Fragment>
              );
            })}
            {g.id === 'requests' && config.data?.requests === 'silo' && (
              <li className="px-1 text-[11px] leading-relaxed text-ink-4">
                {t('settings.siloRequests')}
              </li>
            )}
            {g.id === 'indexers' && (
              <li>
                <Card className="transition hover:bg-white/[0.02]">
                <Link to="/settings/downloads" className="flex items-center gap-3 px-5 py-4 text-left">
                  <Download className="size-5 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium">{t('settings.tabs.downloads.label')}</span>
                    <span className="block text-[11px] text-ink-4">{t('settings.downloadClientsHint')}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-ink-4" />
                </Link>
                </Card>
              </li>
            )}
          </ul>
          {g.id === 'media' && !main.other && <MoonfinSection grouped />}
          {g.id === 'metadata' && <KometaSection grouped />}
        </Group>
      ))}
      <p className="flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-ink-4">
        <KeyRound className="size-3" /> {t('settings.keysNote')}
        <Link to="/setup" className="text-brand hover:underline">{t('settings.findApps')}</Link>
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const t = useT();
  const main = useMainServer();
  const { section = '' } = useParams();
  const updates = useUpdates(!!user?.isAdmin);

  if (!user?.isAdmin) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title={t('settings.adminsOnly')} description={t('settings.adminsOnlyDescription')} />
      </Card>
    );
  }
  const tab = TABS.find((t) => t.path === section);
  if (!tab) return <Navigate to="/settings" replace />;

  return (
    <>
      <PageHeader eyebrow={t('settings.eyebrow')} title={t('settings.title')} description={t(`settings.tabs.${tab.key}.description`)} />
      <SettingsTabs update={updates.data?.available} />
      {/* Each section brings its own heading; the first needs no gap above it. */}
      <div className="[&>section:first-child]:mt-0">
        {tab.path === '' && <ServicesTab />}
        {tab.path === 'downloads' && <ClientsSection />}
        {tab.path === 'notifications' && <NotificationsSection />}
        {tab.path === 'access' && (
          <>
            <MembersSection />
            {!main.other && <SsoSection />}
          </>
        )}
        {tab.path === 'system' && (
          <>
            <UpdatesSection />
            <BackupSection />
          </>
        )}
      </div>
    </>
  );
}

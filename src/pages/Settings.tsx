import { Fragment, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
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
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHealth, useResetService, useSaveService, useServiceSettings, useSetServiceEnabled, useTestService } from '@/hooks/queries';
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
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';

/** Where each service keeps its API key, and an example address. */
const HELP: Record<ServiceId, { placeholder: string; keyHelp: string; keyOptional?: boolean }> = {
  jellyfin: {
    placeholder: 'https://jellyfin.example.com',
    keyHelp: 'Optional. Dashboard → API Keys. Enables server-wide data and update/restart warnings.',
    keyOptional: true,
  },
  sonarr: { placeholder: 'https://sonarr.example.com', keyHelp: 'Settings → General → Security → API Key' },
  radarr: { placeholder: 'https://radarr.example.com', keyHelp: 'Settings → General → Security → API Key' },
  prowlarr: { placeholder: 'https://prowlarr.example.com', keyHelp: 'Settings → General → Security → API Key' },
  seerr: { placeholder: 'https://seerr.example.com', keyHelp: 'Settings → General → API Key' },
  infinidisk: {
    placeholder: 'https://infinidisk.example.com',
    keyHelp: 'Optional if the status endpoint is public.',
    keyOptional: true,
  },
};

const ORDER: ServiceId[] = ['jellyfin', 'sonarr', 'radarr', 'prowlarr', 'seerr', 'infinidisk'];

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
  if (s.source === 'database')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
        <Database className="size-3" /> Saved in StreamForge
      </span>
    );
  if (s.source === 'environment')
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-ink-3">
        <Server className="size-3" /> From environment
      </span>
    );
  return null;
}

function TestResult({ result }: { result: ConnectionTest }) {
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
          Connected{result.version ? ` · v${result.version}` : ''} · {result.latencyMs} ms
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
  apiKey: string;
  clearKey: boolean;
  authHeader: string;
  statusPath: string;
  healthPath: string;
  mounts: string;
}

const initial = (s: ServiceSettingsView): FormState => ({
  url: s.url,
  apiKey: '',
  clearKey: false,
  authHeader: s.authHeader ?? '',
  statusPath: s.statusPath ?? '',
  healthPath: s.healthPath ?? '',
  mounts: (s.mounts ?? []).join('\n'),
});

function toInput(id: ServiceId, f: FormState): ServiceSettingsInput {
  const input: ServiceSettingsInput = { url: f.url.trim() };
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
  const meta = SERVICES[s.id];
  const help = HELP[s.id];
  const { logout } = useAuth();
  const health = useHealth();
  const status = health.data?.services.find((h) => h.id === s.id)?.status;

  const [form, setForm] = useState(() => initial(s));
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);
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
    ? 'Key will be removed'
    : s.apiKeySet
      ? `Saved (${s.apiKeyHint ?? '••••'}) — leave blank to keep`
      : help.keyOptional
        ? 'Optional'
        : 'Paste API key';

  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <Card>
        <form onSubmit={onSave} noValidate>
          <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <ServiceIcon id={s.id} size={36} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight">{meta.name}</h2>
              <p className="text-xs text-ink-3">{meta.tagline}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <SourceBadge s={s} />
              {!s.enabled ? <Pill>Disabled</Pill> : status && <StatusBadge status={status} />}
            </div>
            {s.canDisable && (
              <Switch
                checked={s.enabled}
                disabled={toggle.isPending}
                onChange={(v) => toggle.mutate(v)}
                label={s.enabled ? `Disable ${meta.name}` : `Enable ${meta.name}`}
                className="ml-1"
              />
            )}
          </header>
          {!s.enabled && (
            <p className="border-b border-line bg-white/[0.02] px-5 py-2.5 text-xs text-ink-3">
              Switched off — hidden from navigation and the dashboard, and StreamForge won’t contact it. Settings are kept.
            </p>
          )}
          {toggle.error && (
            <p className="border-b border-line px-5 py-2.5 text-xs text-bad" role="alert">{(toggle.error as Error).message}</p>
          )}

          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <Field
              label="Server address"
              htmlFor={`${s.id}-url`}
              error={fieldError('url')}
              help={s.id === 'jellyfin' ? 'Changing the server signs everyone out.' : 'The address StreamForge’s server uses to reach it.'}
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

            <Field label={help.keyOptional ? 'API key (optional)' : 'API key'} htmlFor={`${s.id}-key`} error={fieldError('apiKey')} help={help.keyHelp}>
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
                      {form.clearKey ? 'Undo' : 'Remove'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="grid size-7 place-items-center rounded-md text-ink-4 hover:text-ink-2"
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
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
                  Advanced
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
                        <Field label="API key header" htmlFor="inf-header" error={fieldError('authHeader')} help="e.g. X-Api-Key">
                          <input id="inf-header" className={inputCls} spellCheck={false} value={form.authHeader} onChange={(e) => set('authHeader', e.target.value)} />
                        </Field>
                        <Field label="Status path" htmlFor="inf-status" error={fieldError('statusPath')} help="Returns drive status as JSON">
                          <input id="inf-status" className={inputCls} spellCheck={false} placeholder="/api/status" value={form.statusPath} onChange={(e) => set('statusPath', e.target.value)} />
                        </Field>
                        <Field label="Health path" htmlFor="inf-health" error={fieldError('healthPath')} help="Optional liveness check">
                          <input id="inf-health" className={inputCls} spellCheck={false} value={form.healthPath} onChange={(e) => set('healthPath', e.target.value)} />
                        </Field>
                        <div className="md:col-span-3">
                          <Field
                            label="Local mount paths"
                            htmlFor="inf-mounts"
                            error={fieldError('mounts')}
                            help="One per line. Paths visible to the StreamForge server, measured directly."
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
                <span className="text-ok">Saved — applied immediately</span>
              ) : s.source === 'database' && s.updatedAt ? (
                <>Updated {relative(s.updatedAt)}{s.updatedBy && s.updatedBy !== 'setup' ? ` by ${s.updatedBy}` : ''}</>
              ) : s.source === 'environment' ? (
                'Saving here overrides the environment variables'
              ) : (
                'Not connected'
              )}
            </p>
            {s.source === 'database' && s.envAvailable && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onReset()} title="Remove saved settings and use the environment variables">
                {reset.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                Use environment
              </Button>
            )}
            <Button type="button" size="sm" disabled={busy || (!form.url.trim() && !form.mounts.trim())} onClick={() => test.mutate(toInput(s.id, form))}>
              {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
              Test connection
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty}>
              {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save
            </Button>
          </footer>
        </form>
      </Card>
    </motion.li>
  );
}

/* --------------------------------- page --------------------------------- */

export default function SettingsPage() {
  const { user } = useAuth();
  const q = useServiceSettings();

  if (!user?.isAdmin) {
    return (
      <Card>
        <EmptyState icon={ShieldAlert} title="Administrators only" description="Ask a Jellyfin administrator to change StreamForge's settings." />
      </Card>
    );
  }

  const byId = new Map(q.data?.services.map((s) => [s.id, s]));
  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connect your services, or switch off the ones you don’t use. Changes apply immediately — no restart needed."
      />
      {q.isError ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : !q.data ? (
        <div className="space-y-4">
          {ORDER.map((id) => <Skeleton key={id} className="h-56 rounded-[1.25rem]" />)}
        </div>
      ) : (
        <ul className="space-y-4">
          {ORDER.map((id, i) => {
            const s = byId.get(id);
            if (!s) return null;
            return (
              <Fragment key={id}>
                <ServiceCard s={s} index={i} />
                {(id === 'sonarr' || id === 'radarr') && s.enabled && <InstancesSection kind={id} />}
              </Fragment>
            );
          })}
        </ul>
      )}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-4">
        <KeyRound className="size-3" /> API keys are stored on the StreamForge server and never sent to your browser.
      </p>
    </>
  );
}

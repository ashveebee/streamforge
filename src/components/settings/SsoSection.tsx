import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, Copy, KeyRound, LoaderCircle, PlugZap, Save, ShieldCheck } from 'lucide-react';
import { useResetMfa, useSaveSso, useSso, useTestSso } from '@/hooks/useSecurity';
import { relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';

/** OpenID Connect single sign-on, and who uses two-factor sign-in. */
export function SsoSection() {
  const q = useSso();
  const save = useSaveSso();
  const test = useTestSso();
  const reset = useResetMfa();
  const [f, setF] = useState({ issuer: '', clientId: '', clientSecret: '', label: '', claim: '' });
  useEffect(() => {
    if (q.data) setF({ issuer: q.data.issuer, clientId: q.data.clientId, clientSecret: '', label: q.data.label, claim: q.data.claim });
  }, [q.data]);
  const d = q.data;
  if (!d) return null;
  const set = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    save.reset();
    test.reset();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ issuer: f.issuer.trim(), clientId: f.clientId.trim(), clientSecret: f.clientSecret || undefined, label: f.label.trim() || 'Single sign-on', claim: f.claim.trim() || 'preferred_username' });
  };
  const ready = !!(d.issuer && d.clientId);
  return (
    <section className="mt-8" aria-labelledby="sso-h">
      <h2 id="sso-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight"><ShieldCheck className="size-4 text-brand" /> Sign-in security</h2>
      <p className="mb-3 text-xs text-ink-3">Let people sign in through your identity provider (Authentik, Authelia, Keycloak, Pocket ID, …). Everyone can also turn on two-factor sign-in from their own page.</p>
      <Card>
        <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-[13px] font-medium">Single sign-on (OpenID Connect)</div>
              <div className="text-[11px] text-ink-4">Accounts are matched to Jellyfin users by name. Needs a Jellyfin API key.</div>
            </div>
            <Switch checked={d.enabled} disabled={save.isPending || (!d.enabled && (!ready || !d.hasApiKey))} onChange={(v) => save.mutate({ enabled: v })} label="Turn single sign-on on or off" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input className="h-9" type="url" placeholder="Issuer URL, e.g. https://auth.example.com/application/o/streamforge/" value={f.issuer} onChange={(e) => set('issuer', e.target.value)} aria-label="Issuer URL" />
            <Input className="h-9" placeholder="Client ID" value={f.clientId} onChange={(e) => set('clientId', e.target.value)} aria-label="Client ID" autoComplete="off" />
            <div className="relative">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
              <Input className="h-9 pl-8" type="password" autoComplete="new-password" placeholder={d.clientSecretSet ? `Saved ${d.clientSecretHint ?? '••••'} — blank keeps it` : 'Client secret'} value={f.clientSecret} onChange={(e) => set('clientSecret', e.target.value)} aria-label="Client secret" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input className="h-9" placeholder="Button label" value={f.label} onChange={(e) => set('label', e.target.value)} aria-label="Button label" />
              <Input className="h-9 font-mono text-[12px]" placeholder="preferred_username" value={f.claim} onChange={(e) => set('claim', e.target.value)} aria-label="Username claim" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-[11px] text-ink-3">
            Redirect URI to register with your provider: <code className="break-all text-ink-2 select-all">{d.redirectUri}</code>
            <button type="button" className="text-ink-4 hover:text-ink-2" aria-label="Copy redirect URI" onClick={() => void navigator.clipboard?.writeText(d.redirectUri)}><Copy className="size-3.5" /></button>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <input type="checkbox" className="accent-violet-500" checked={d.hidePassword} onChange={(e) => save.mutate({ hidePassword: e.target.checked })} /> Hide the password form on the sign-in page (it stays reachable at /login?password)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto text-xs">
              {save.error ? (
                <span className="text-bad">{(save.error as Error).message}</span>
              ) : test.data ? (
                test.data.ok ? (
                  <span className="inline-flex items-center gap-1 text-ok"><CircleCheck className="size-3.5" /> Found {test.data.issuer}{test.data.matches ? '' : ' (issuer differs from the URL — use this exact value)'}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-bad"><CircleX className="size-3.5" /> {test.data.message}</span>
                )
              ) : !d.hasApiKey ? (
                <span className="text-warn">Add a Jellyfin API key on the Jellyfin card first.</span>
              ) : null}
            </div>
            <Button type="button" size="sm" disabled={test.isPending || !f.issuer} onClick={() => test.mutate(f.issuer.trim())}>
              {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Test
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
              {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
            </Button>
          </div>
        </form>
        <div className="border-t border-line px-5 py-4">
          <div className="text-[13px] font-medium">Two-factor sign-in</div>
          {d.mfaUsers.length ? (
            <ul className="mt-2 divide-y divide-line">
              {d.mfaUsers.map((u) => (
                <li key={u.userId} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="flex-1">{u.userName} <span className="text-[11px] text-ink-4">· since {relative(u.enabledAt)}</span></span>
                  <Button size="sm" variant="ghost" disabled={reset.isPending} onClick={() => confirm(`Turn off two-factor sign-in for ${u.userName}? Use this if they lost their phone and recovery codes.`) && reset.mutate(u.userId)}>
                    Reset
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-ink-4">Nobody uses it yet. Each person can turn it on from their own page (click your name in the sidebar).</p>
          )}
        </div>
      </Card>
    </section>
  );
}

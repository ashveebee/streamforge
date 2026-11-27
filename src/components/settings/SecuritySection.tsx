import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { Copy, LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { useMfa, useMfaDisable, useMfaEnable, useMfaSetup } from '@/hooks/useSecurity';
import { relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { t } from '@/i18n';

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(text, { margin: 1, width: 200, color: { dark: '#000000', light: '#ffffff' } }).then(setSrc);
  }, [text]);
  return src ? <img src={src} alt={t('sec.mfa.qr')} width={160} height={160} className="rounded-lg" /> : <div className="size-40 rounded-lg bg-white/5" />;
}

/** Two-factor sign-in for the signed-in user. */
export function SecuritySection() {
  const q = useMfa();
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const disable = useMfaDisable();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>();
  const d = q.data;
  if (!d) return null;

  const onEnable = (e: FormEvent) => {
    e.preventDefault();
    enable.mutate(code, {
      onSuccess: (r) => {
        setCodes(r.recoveryCodes);
        setCode('');
        setup.reset();
      },
    });
  };
  const onDisable = (e: FormEvent) => {
    e.preventDefault();
    disable.mutate(code, { onSuccess: () => setCode('') });
  };

  return (
    <Card>
      <CardHeader
        icon={d.enabled ? ShieldCheck : ShieldOff}
        accent={d.enabled ? 'var(--color-ok)' : 'var(--color-ink-3)'}
        title={t('login.mfa.title')}
        subtitle={d.enabled ? `${t('sec.mfa.onSince', { when: relative(d.enabledAt) })} · ${t('sec.mfa.codesLeft', { count: d.recoveryLeft })}` : t('sec.mfa.about')}
        action={d.enabled ? <Pill tone="ok">{t('widgets.cleanup.on')}</Pill> : undefined}
      />
      <CardBody>
        {codes ? (
          <div>
            <p className="mb-2 text-xs text-ink-2">{t('sec.mfa.saveCodes')}</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-white/[0.02] p-3 font-mono text-[13px]">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}><Copy className="size-3.5" /> {t('sec.mfa.copy')}</Button>
              <Button size="sm" variant="primary" onClick={() => setCodes(undefined)}>{t('sec.mfa.saved')}</Button>
            </div>
          </div>
        ) : d.enabled ? (
          <form onSubmit={onDisable} className="flex flex-wrap items-center gap-2">
            <Input className="h-9 w-44" inputMode="numeric" autoComplete="one-time-code" placeholder={t('sec.mfa.current')} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('sec.mfa.currentLabel')} />
            <Button size="sm" type="submit" disabled={disable.isPending || code.trim().length < 6}>
              {disable.isPending && <LoaderCircle className="size-3.5 animate-spin" />} {t('sec.mfa.turnOff')}
            </Button>
            {disable.error && <span className="text-xs text-bad">{(disable.error as Error).message}</span>}
          </form>
        ) : setup.data ? (
          <form onSubmit={onEnable} className="flex flex-wrap items-start gap-4">
            <Qr text={setup.data.uri} />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs text-ink-2">{t('sec.mfa.scan')}</p>
              <p className="text-[11px] text-ink-4">{t('sec.mfa.cantScan')} <code className="break-all text-ink-3 select-all">{setup.data.secret}</code></p>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-9 w-36" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('sec.mfa.codeLabel')} autoFocus />
                <Button size="sm" variant="primary" type="submit" disabled={enable.isPending || code.trim().length < 6}>
                  {enable.isPending && <LoaderCircle className="size-3.5 animate-spin" />} {t('sec.mfa.turnOn')}
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setup.reset()}>{t('media.cancel')}</Button>
              </div>
              {enable.error && <p className="text-xs text-bad">{(enable.error as Error).message}</p>}
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={setup.isPending} onClick={() => setup.mutate()}>
              {setup.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} {t('sec.mfa.setUp')}
            </Button>
            {d.sso && <span className="text-[11px] text-ink-4">{t('sec.mfa.ssoNote')}</span>}
            {setup.error && <span className="text-xs text-bad">{(setup.error as Error).message}</span>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

import { useDeferredValue, useState } from 'react';
import { CircleCheck, CircleX, LoaderCircle, ScrollText, Search, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAudit } from '@/hooks/useAudit';
import { relative } from '@/lib/format';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Loader } from '@/components/ui/Loader';
import { getLocale, t } from '@/i18n';

const CATEGORIES = ['auth', 'settings', 'jellyfin', 'seerr', 'queue', 'search', 'cleanup', 'auto-import', 'notify', 'storage'] as const;
const label = (c: string) => ((CATEGORIES as readonly string[]).includes(c) ? t(`admin.audit.cat.${c as (typeof CATEGORIES)[number]}`) : c.charAt(0).toUpperCase() + c.slice(1));

export default function AuditPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState('');
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const q = useDeferredValue(text);
  const audit = useAudit({ category, user: who, q });

  if (!user?.isAdmin) {
    return <Card><EmptyState icon={ShieldAlert} title={t('settings.adminsOnly')} description={t('admin.audit.adminsOnly')} /></Card>;
  }
  const first = audit.data?.pages[0];
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader eyebrow={t('admin.audit.eyebrow')} title={t('nav.auditLog')} description={t('admin.audit.description')} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <label className="relative">
          <span className="sr-only">{t('nav.search')}</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
          <Input className="pl-9" placeholder={t('admin.audit.search')} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Select aria-label={t('admin.audit.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('admin.audit.allCategories')}</option>
          {first?.categories.map((c) => <option key={c} value={c}>{label(c)}</option>)}
        </Select>
        <Select aria-label={t('admin.audit.user')} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t('watch.history.everyone')}</option>
          {first?.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
      </div>
      <Card>
        {audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : !audit.data ? (
          <Loader label={t('admin.audit.loading')} className="min-h-[360px]" />
        ) : !entries.length ? (
          <EmptyState icon={ScrollText} title={t('admin.audit.none')} description={q || category || who ? t('admin.audit.noMatch') : t('admin.audit.noneHint')} />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                {e.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] break-words text-ink">{e.message}</div>
                  <div className="mt-0.5 text-[11px] text-ink-4">
                    {e.userName ?? t('admin.audit.system')}
                    {e.ip ? ` · ${e.ip}` : ''} · <time dateTime={e.at} title={new Date(e.at).toLocaleString(getLocale())}>{relative(e.at)}</time>
                  </div>
                </div>
                <Pill className="shrink-0">{label(e.category)}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {audit.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
            {audit.isFetchingNextPage && <LoaderCircle className="size-3.5 animate-spin" />} {t('admin.audit.older')}
          </Button>
        </div>
      )}
    </>
  );
}

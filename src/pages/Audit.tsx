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
import { getLocale } from '@/i18n';

const CATEGORY_LABEL: Record<string, string> = {
  auth: 'Sign-in',
  settings: 'Settings',
  jellyfin: 'Streams',
  seerr: 'Requests',
  queue: 'Queue',
  search: 'Search',
  cleanup: 'Cleanup',
  'auto-import': 'Auto-import',
  notify: 'Notifications',
  storage: 'Storage',
};
const label = (c: string) => CATEGORY_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

export default function AuditPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState('');
  const [who, setWho] = useState('');
  const [text, setText] = useState('');
  const q = useDeferredValue(text);
  const audit = useAudit({ category, user: who, q });

  if (!user?.isAdmin) {
    return <Card><EmptyState icon={ShieldAlert} title="Administrators only" description="Only administrators can see the audit log." /></Card>;
  }
  const first = audit.data?.pages[0];
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <>
      <PageHeader eyebrow="Security" title="Audit log" description="Every change made through StreamForge and who made it. Kept for 180 days." />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
        <label className="relative">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
          <Input className="pl-9" placeholder="Search actions" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {first?.categories.map((c) => <option key={c} value={c}>{label(c)}</option>)}
        </Select>
        <Select aria-label="User" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {first?.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
      </div>
      <Card>
        {audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : !audit.data ? (
          <Loader label="Loading the audit log" className="min-h-[360px]" />
        ) : !entries.length ? (
          <EmptyState icon={ScrollText} title="Nothing recorded" description={q || category || who ? 'No entries match these filters.' : 'Actions will show up here as people use StreamForge.'} />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                {e.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleX className="mt-0.5 size-4 shrink-0 text-bad" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] break-words text-ink">{e.message}</div>
                  <div className="mt-0.5 text-[11px] text-ink-4">
                    {e.userName ?? 'System'}
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
            {audit.isFetchingNextPage && <LoaderCircle className="size-3.5 animate-spin" />} Load older entries
          </Button>
        </div>
      )}
    </>
  );
}

import { ExternalLink, Timer } from 'lucide-react';
import { useHealth } from '@/hooks/queries';
import { relative } from '@/lib/format';
import type { ServiceId } from '@/lib/types';
import { SERVICES, ServiceIcon } from '../ui/ServiceIcon';
import { StatusBadge } from '../ui/Status';
import { PageHeader } from './PageHeader';

export function ServiceHeader({ id, description, actions }: { id: ServiceId; description?: string; actions?: React.ReactNode }) {
  const health = useHealth();
  const s = health.data?.services.find((x) => x.id === id);
  const meta = SERVICES[id];
  return (
    <>
      <PageHeader
        icon={<ServiceIcon id={id} size={52} className="rounded-2xl" />}
        eyebrow={meta.tagline}
        title={meta.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {s && <StatusBadge status={s.status} />}
            {s?.version && <span>v{s.version}</span>}
            {s?.latencyMs !== undefined && (
              <span className="inline-flex items-center gap-1"><Timer className="size-3.5" />{s.latencyMs} ms</span>
            )}
            {s?.lastSuccess && <span className="text-ink-4">Last healthy check {relative(s.lastSuccess)}</span>}
            {description && <span className="text-ink-4">{description}</span>}
          </span>
        }
        actions={actions}
      />
      {s && s.issues.length > 0 && (
        <div className="mb-6 space-y-2">
          {s.issues.map((i, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
                i.level === 'error' ? 'border-bad/25 bg-bad/[0.06] text-bad' : i.level === 'warning' ? 'border-warn/25 bg-warn/[0.06] text-warn' : 'border-line bg-white/[0.02] text-ink-2'
              }`}
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-current" />
              <div className="flex-1">
                <span className="text-ink">{i.message}</span>
                {i.source && <span className="ml-2 text-xs text-ink-4">{i.source}</span>}
              </div>
              {i.wikiUrl && /^https:\/\//.test(i.wikiUrl) && (
                <a href={i.wikiUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
                  Docs <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {s && s.status === 'offline' && s.error && (
        <div className="mb-6 rounded-xl border border-bad/25 bg-bad/[0.06] px-4 py-3 text-sm text-bad">
          <span className="font-medium">Unreachable:</span> <span className="text-ink-2">{s.error}</span>
        </div>
      )}
    </>
  );
}

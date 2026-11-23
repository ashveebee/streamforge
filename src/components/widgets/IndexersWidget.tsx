import { Radar } from 'lucide-react';
import { useProwlarr } from '@/hooks/queries';
import { compact, pct } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Indexer } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { QueryState, SkeletonRows } from '../ui/States';

export const INDEXER_TONE: Record<Indexer['health'], { label: string; cls: string; dot: string }> = {
  healthy: { label: 'Healthy', cls: 'text-ok', dot: 'bg-ok' },
  failing: { label: 'Failing', cls: 'text-bad', dot: 'bg-bad' },
  disabled: { label: 'Disabled', cls: 'text-ink-4', dot: 'bg-idle' },
};

export function IndexersWidget() {
  const q = useProwlarr();
  return (
    <Card className="h-full">
      <CardHeader icon={Radar} accent="var(--color-prowlarr)" title="Indexers" subtitle="Prowlarr" />
      <CardBody>
        <QueryState query={q} skeleton={<SkeletonRows rows={4} />}>
          {(d) => {
            const max = Math.max(1, ...d.indexers.map((i) => i.stats.queries));
            return (
              <>
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-3xl font-semibold tabular">
                      {d.summary.healthy}
                      <span className="text-lg text-ink-4">/{d.summary.enabled}</span>
                    </div>
                    <div className="text-xs text-ink-3">healthy indexers</div>
                  </div>
                  <div className="ml-auto grid grid-cols-3 gap-4 text-right text-xs">
                    <div><div className="font-semibold text-ink tabular">{compact(d.summary.queries)}</div><div className="text-ink-4">queries</div></div>
                    <div><div className="font-semibold text-ink tabular">{compact(d.summary.grabs)}</div><div className="text-ink-4">grabs</div></div>
                    <div><div className="font-semibold text-ink tabular">{d.summary.avgResponseMs}ms</div><div className="text-ink-4">avg</div></div>
                  </div>
                </div>
                {/* Health segments: one block per indexer. */}
                <div className="mt-4 flex gap-0.5" role="img" aria-label={`${d.summary.healthy} healthy, ${d.summary.failing} failing, ${d.summary.disabled} disabled`}>
                  {d.indexers.map((i) => (
                    <span key={i.id} title={`${i.name}: ${INDEXER_TONE[i.health].label}`} className={cn('h-2 flex-1 rounded-sm first:rounded-l-full last:rounded-r-full', INDEXER_TONE[i.health].dot)} />
                  ))}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {d.indexers.slice(0, 5).map((i) => (
                    <li key={i.id} className="text-[13px]">
                      <div className="flex items-center gap-2">
                        <span className={cn('size-1.5 rounded-full', INDEXER_TONE[i.health].dot)} />
                        <span className="flex-1 truncate">{i.name}</span>
                        <span className="text-[11px] text-ink-3 tabular">{compact(i.stats.queries)} · {i.stats.successRate !== undefined ? pct(i.stats.successRate) : '—'}</span>
                      </div>
                      <div className="mt-1 ml-3.5 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                        <div className="h-full rounded-full bg-prowlarr/70" style={{ width: `${(i.stats.queries / max) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            );
          }}
        </QueryState>
      </CardBody>
    </Card>
  );
}

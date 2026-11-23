import { Inbox } from 'lucide-react';
import { useSeerr } from '@/hooks/queries';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { SeerrRequest } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FadeImage } from '../ui/Image';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { EmptyState, QueryState, SkeletonRows } from '../ui/States';

export const REQUEST_TONE: Record<SeerrRequest['status'], string> = {
  pending: 'text-warn bg-warn/10 border-warn/25',
  approved: 'text-ok bg-ok/10 border-ok/25',
  completed: 'text-ok bg-ok/10 border-ok/25',
  declined: 'text-bad bg-bad/10 border-bad/25',
  failed: 'text-bad bg-bad/10 border-bad/25',
  unknown: 'text-ink-3 bg-white/5 border-line',
};

export function RequestRow({ r }: { r: SeerrRequest }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <FadeImage src={r.poster} alt="" className="h-14 w-10 shrink-0 rounded-md ring-1 ring-white/10" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">
          {r.title} {r.year && <span className="font-normal text-ink-4">({r.year})</span>}
        </div>
        <div className="truncate text-[11px] text-ink-3">
          {r.type === 'tv' ? `Series${r.seasons.length ? ` · S${r.seasons.join(', S')}` : ''}` : 'Movie'}
          {r.is4k && ' · 4K'} · {r.requestedBy}
        </div>
        <div className="text-[11px] text-ink-4">{relative(r.createdAt)}</div>
      </div>
      <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold capitalize', REQUEST_TONE[r.status])}>
        {r.status === 'approved' && r.mediaStatus === 'available' ? 'available' : r.status}
      </span>
    </li>
  );
}

export function RequestsWidget() {
  const q = useSeerr();
  return (
    <Card className="h-full">
      <CardHeader icon={Inbox} accent="var(--color-seerr)" title="Requests" subtitle="Seerr" />
      <CardBody>
        <QueryState query={q} skeleton={<SkeletonRows rows={4} />}>
          {(d) => (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Pending', value: d.counts.pending, cls: 'text-warn' },
                  { label: 'Approved', value: d.counts.approved, cls: 'text-ok' },
                  { label: 'Available', value: d.counts.available, cls: 'text-ink' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                    <div className={cn('text-xl font-semibold tabular', s.cls)}><AnimatedNumber value={s.value} /></div>
                    <div className="text-[11px] text-ink-3">{s.label}</div>
                  </div>
                ))}
              </div>
              {d.recent.length ? (
                <ul className="mt-3 divide-y divide-line">
                  {(d.pending.length ? d.pending : d.recent).slice(0, 4).map((r) => <RequestRow key={r.id} r={r} />)}
                </ul>
              ) : (
                <EmptyState icon={Inbox} title="No requests yet" className="py-6" />
              )}
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

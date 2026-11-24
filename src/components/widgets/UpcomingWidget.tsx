import { CalendarDays, CheckCircle2 } from 'lucide-react';
import { useArrAll } from '@/hooks/queries';
import { dayLabel, timeOfDay } from '@/lib/format';
import type { UpcomingItem } from '@/lib/types';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { FadeImage } from '../ui/Image';
import { EmptyState, SkeletonRows } from '../ui/States';
import { TitleLink, arrTitlePath } from '@/components/ui/TitleLink';

const KIND_LABEL: Record<UpcomingItem['kind'], string> = {
  episode: 'Airs',
  cinema: 'In cinemas',
  digital: 'Digital release',
  physical: 'Physical release',
};

export function groupByDay(items: UpcomingItem[]) {
  const groups = new Map<string, UpcomingItem[]>();
  for (const i of items) {
    const d = new Date(i.date);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.entries()];
}

export function UpcomingList({ items, limit }: { items: UpcomingItem[]; limit?: number }) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const visible = items.filter((i) => Date.parse(i.date) >= startOfToday.getTime()).slice(0, limit);
  if (!visible.length) {
    return <EmptyState icon={CalendarDays} title="Nothing scheduled" description="No monitored releases in the coming weeks." />;
  }
  return (
    <div className="space-y-4">
      {groupByDay(visible).map(([day, list]) => (
        <div key={day}>
          <div className="sticky top-0 mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{dayLabel(day)}</div>
          <ul className="space-y-1">
            {list.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-xl p-1.5 transition hover:bg-white/[0.03]">
                <FadeImage src={i.poster} alt="" className="h-14 w-10 shrink-0 rounded-md ring-1 ring-white/10" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: i.source === 'sonarr' ? 'var(--color-sonarr)' : 'var(--color-radarr)' }} />
                    <TitleLink to={arrTitlePath(i.source, i.tmdbId)} className="truncate text-[13px] font-medium">{i.title}</TitleLink>
                  </div>
                  <div className="truncate text-[11px] text-ink-3">{i.subtitle}</div>
                  <div className="truncate text-[11px] text-ink-4">
                    {KIND_LABEL[i.kind]}
                    {i.kind === 'episode' ? ` ${timeOfDay(i.date)}` : ''}
                    {i.network ? ` · ${i.network}` : ''}
                  </div>
                </div>
                {i.hasFile && <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label="Downloaded" />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function UpcomingWidget() {
  const all = [...useArrAll('sonarr'), ...useArrAll('radarr')];
  // The same release often appears in several instances (e.g. HD and 4K).
  const seen = new Set<string>();
  const items = all
    .flatMap((r) => r.data?.upcoming ?? [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((i) => {
      const k = `${i.source}|${i.title}|${i.subtitle}|${i.kind}|${i.date}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const loading = all.some((r) => r.isPending && r.fetchStatus !== 'idle');
  const none = all.length === 0;
  return (
    <Card className="flex h-full flex-col">
      <CardHeader icon={CalendarDays} title="Upcoming" subtitle="Episodes & releases from Sonarr and Radarr" />
      <CardBody className="max-h-[440px] flex-1 overflow-y-auto">
        {none ? (
          <EmptyState icon={CalendarDays} title="Not connected" description="Connect Sonarr or Radarr to see upcoming releases." />
        ) : loading && !items.length ? (
          <SkeletonRows rows={5} />
        ) : (
          <UpcomingList items={items} limit={14} />
        )}
      </CardBody>
    </Card>
  );
}

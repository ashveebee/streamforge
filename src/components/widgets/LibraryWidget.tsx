import { BookOpen, Clapperboard, Disc3, Film, Library, Tv, Users } from 'lucide-react';
import { useJellyfin } from '@/hooks/queries';
import { compact } from '@/lib/format';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { StatTile } from '../ui/Stat';
import { QueryState, Skeleton } from '../ui/States';

export const LIBRARY_ICONS: Record<string, typeof Film> = {
  movies: Film,
  tvshows: Tv,
  music: Disc3,
  books: BookOpen,
};

export function LibraryWidget() {
  const q = useJellyfin();
  return (
    <Card className="h-full">
      <CardHeader icon={Library} accent="var(--color-jellyfin)" title="Library" subtitle={q.data ? `${q.data.libraries.length} libraries on ${q.data.server.name}` : 'Jellyfin'} />
      <CardBody>
        <QueryState query={q} skeleton={<div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>}>
          {(d) => (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Movies" value={d.counts.movies} icon={Film} accent="var(--color-radarr)" format={(n) => compact(Math.round(n))} />
                <StatTile label="Series" value={d.counts.series} icon={Tv} accent="var(--color-sonarr)" format={(n) => compact(Math.round(n))} hint={`${compact(d.counts.episodes)} episodes`} />
                <StatTile label="Albums" value={d.counts.albums} icon={Disc3} accent="var(--color-jellyfin)" format={(n) => compact(Math.round(n))} hint={`${compact(d.counts.songs)} songs`} />
                <StatTile label="Users" value={d.users.total} icon={Users} accent="var(--color-seerr)" hint={`${d.users.active24h} active today`} />
              </div>
              <ul className="mt-4 space-y-1">
                {d.libraries.map((l) => {
                  const Icon = LIBRARY_ICONS[l.type] ?? Clapperboard;
                  return (
                    <li key={l.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-white/[0.03]">
                      <Icon className="size-4 text-ink-4" />
                      <span className="flex-1 truncate">{l.name}</span>
                      {l.refreshing && <span className="text-[11px] text-brand">Scanning {Math.round(l.refreshProgress ?? 0)}%</span>}
                      <span className="text-ink-3 tabular">{l.itemCount !== undefined ? l.itemCount.toLocaleString() : '—'}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

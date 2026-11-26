import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, History as HistoryIcon, LoaderCircle, MonitorPlay, Search, Tv, Users } from 'lucide-react';
import { api, jfUserImage } from '@/lib/api';
import { dayLabel, duration, num, relative, timeOfDay } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Image';
import { PageLoader } from '@/components/ui/Loader';
import { Pill } from '@/components/ui/Status';
import { EmptyState, QueryState } from '@/components/ui/States';

interface HistoryRow {
  id: string;
  user: string;
  at: string;
  title: string;
  subtitle?: string;
  type: 'movie' | 'episode' | 'other';
  client?: string;
  device?: string;
  server?: string;
  method?: string;
  watchedMs?: number;
  source: 'recorded' | 'server';
}
interface HistoryResult {
  days: number;
  users: { name: string; plays: number; watchedMs: number; lastAt?: string; id?: string; imageTag?: string }[];
  summary: { plays: number; watchedMs: number; titles: number; movies: number; episodes: number; transcodePct?: number; top: { title: string; plays: number; type: string }[]; device?: string };
  rows: HistoryRow[];
  total: number;
  recordingSince?: number;
  serverHistory?: 'jellyfin' | 'plex';
}

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
  { days: 0, label: 'All time' },
];
const SERVER_LABEL = { jellyfin: 'Jellyfin', plex: 'Plex' } as const;

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/[0.02] px-4 py-3">
      <div className="text-xl font-semibold tabular">{value}</div>
      <div className="text-[11px] text-ink-4">{label}</div>
    </div>
  );
}

export default function HistoryPage() {
  const [params, setParams] = useSearchParams();
  const user = params.get('user') ?? '';
  const days = Number(params.get('days') ?? 30);
  const [q, setQ] = useState('');
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const query = useQuery({
    queryKey: ['history', days, user, q],
    queryFn: ({ signal }) => api<HistoryResult>(`/history?days=${days}${user ? `&user=${encodeURIComponent(user)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal }),
    placeholderData: (p) => p,
    staleTime: 30_000,
  });
  const d = query.data;
  const groups = useMemo(() => {
    const m = new Map<string, HistoryRow[]>();
    for (const r of d?.rows ?? []) {
      const k = new Date(r.at).toDateString();
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()];
  }, [d?.rows]);
  const selected = d?.users.find((u) => u.name.toLowerCase() === user.toLowerCase());

  return (
    <>
      <PageHeader
        eyebrow="Everyone’s activity"
        title="Watch history"
        description={
          d?.recordingSince
            ? `Recorded by StreamForge since ${new Date(d.recordingSince).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}${d.serverHistory ? `; older plays come from ${SERVER_LABEL[d.serverHistory]}’s own history` : ''}.`
            : 'What each person on your servers has watched.'
        }
      />
      <QueryState query={query} skeleton={<PageLoader label="Loading watch history" />}>
        {(data) => (
          <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
            <Card className="self-start">
              <CardHeader icon={Users} title="People" subtitle={`${data.users.length} with history`} />
              <CardBody className="pt-0">
                <ul className="-mx-2 space-y-0.5">
                  {[{ name: '', plays: data.users.reduce((n, u) => n + u.plays, 0), lastAt: undefined as string | undefined, id: undefined as string | undefined, imageTag: undefined as string | undefined }, ...data.users].map((u) => {
                    const active = u.name.toLowerCase() === user.toLowerCase();
                    return (
                      <li key={u.name || '*'}>
                        <button
                          type="button"
                          onClick={() => set('user', u.name)}
                          aria-current={active || undefined}
                          className={cn('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition', active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]')}
                        >
                          {u.name ? <Avatar src={jfUserImage(u.id, u.imageTag, 64)} name={u.name} size={28} /> : <span className="grid size-7 place-items-center rounded-full bg-brand/15"><Users className="size-3.5 text-brand" /></span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{u.name || 'Everyone'}</span>
                            <span className="block truncate text-[11px] text-ink-4">{u.name ? (u.lastAt ? `Last watched ${relative(u.lastAt)}` : 'Nothing watched') : 'All users'}</span>
                          </span>
                          <span className="text-[11px] tabular text-ink-3">{num(u.plays)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>

            <div className="min-w-0 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <div role="tablist" aria-label="Time range" className="flex flex-wrap gap-1">
                  {RANGES.map((r) => (
                    <button
                      key={r.days}
                      role="tab"
                      aria-selected={days === r.days}
                      onClick={() => set('days', String(r.days))}
                      className={cn('h-8 rounded-xl border px-3 text-xs font-medium transition', days === r.days ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2')}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                {query.isFetching && <LoaderCircle className="size-4 animate-spin text-ink-4" />}
                <label className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Find a title"
                    aria-label="Find a title"
                    className="h-8 w-56 rounded-xl border border-line bg-white/[0.02] pr-3 pl-8 text-xs outline-none placeholder:text-ink-4 focus:border-brand/50"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat value={num(data.summary.plays)} label={`Plays · ${data.summary.movies} movies, ${data.summary.episodes} episodes`} />
                <Stat value={data.summary.watchedMs ? duration(data.summary.watchedMs) : '—'} label="Time watched (recorded plays)" />
                <Stat value={num(data.summary.titles)} label="Different titles" />
                <Stat value={data.summary.transcodePct !== undefined ? `${data.summary.transcodePct}%` : '—'} label="Transcoded" />
              </div>

              {data.summary.top.length > 0 && (
                <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-[13px]">
                    <span className="text-xs text-ink-4">{selected ? `${selected.name} watches most` : 'Most watched'}</span>
                    {data.summary.top.map((t) => (
                      <span key={t.title} className="inline-flex items-center gap-1.5">
                        {t.type === 'episode' ? <Tv className="size-3.5 text-ink-4" /> : <Clapperboard className="size-3.5 text-ink-4" />}
                        {t.title} <span className="text-ink-4 tabular">×{t.plays}</span>
                      </span>
                    ))}
                    {data.summary.device && (
                      <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-3">
                        <MonitorPlay className="size-3.5" /> Usually on {data.summary.device}
                      </span>
                    )}
                </div>
              )}

              <Card>
                <CardHeader icon={HistoryIcon} title={selected ? `${selected.name}’s history` : 'Everyone’s history'} subtitle={data.total > data.rows.length ? `Newest ${data.rows.length} of ${num(data.total)}` : `${num(data.total)} play${data.total === 1 ? '' : 's'}`} />
                <CardBody className="pt-0">
                  {!data.rows.length ? (
                    <EmptyState icon={HistoryIcon} title="Nothing watched in this range" description={q ? 'No titles match your search.' : 'Try a longer time range.'} />
                  ) : (
                    <div className="space-y-4">
                      {groups.map((g) => (
                        <section key={g[0]!.at}>
                          <h3 className="mb-1 py-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{dayLabel(g[0]!.at)}</h3>
                          <ul className="divide-y divide-line">
                            {g.map((r) => (
                              <li key={r.id} className="flex items-center gap-3 py-2">
                                <span className="w-16 shrink-0 text-[11px] tabular text-ink-4">{timeOfDay(r.at)}</span>
                                {!selected && <span className="w-24 shrink-0 truncate text-xs text-ink-2" title={r.user}>{r.user}</span>}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[13px] font-medium">{r.title}</div>
                                  {r.subtitle && <div className="truncate text-[11px] text-ink-3">{r.subtitle}</div>}
                                </div>
                                <div className="hidden min-w-0 shrink text-right text-[11px] text-ink-4 md:block">
                                  {r.source === 'recorded' ? [r.client, r.device, r.server].filter(Boolean).join(' · ') : `From ${d?.serverHistory ? SERVER_LABEL[d.serverHistory] : 'the server'}’s history`}
                                </div>
                                {r.method === 'Transcode' && <Pill tone="warn">Transcode</Pill>}
                                <span className="w-14 shrink-0 text-right text-xs tabular text-ink-2">{r.watchedMs ? duration(r.watchedMs) : ''}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}

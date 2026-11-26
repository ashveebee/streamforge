import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { BarChart3, Clock, MonitorSmartphone, Play, Repeat2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMainServer, usePlaybackStats } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { ServerTag, SERVER_NAME } from '@/components/ui/ServerTag';
import { pct } from '@/lib/format';
import type { PlaybackStats } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '@/components/ui/Chart';
import { StatTile } from '@/components/ui/Stat';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';

const RANGES = [7, 30, 90, 365] as const;
// Validated two-series pair (same as Sonarr/Radarr elsewhere).
const DIRECT = SERIES.sonarr;
const TRANSCODE = SERIES.radarr;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const shortDate = (d: string | number) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function DailyChart({ d }: { d: PlaybackStats }) {
  const main = useMainServer();
  const hasMethod = d.daily.some((x) => x.direct || x.transcode);
  return (
    <Card>
      <CardHeader
        icon={BarChart3}
        accent={SERIES.plays}
        title="Plays per day"
        subtitle={hasMethod ? 'Split by how the stream was delivered' : main.plex ? 'From Plex watch history' : `From the ${main.name} activity log`}
        action={
          hasMethod ? (
            <Legend items={[{ label: 'Direct', color: DIRECT }, { label: 'Transcode', color: TRANSCODE }]} />
          ) : undefined
        }
      />
      <CardBody>
        <div className="h-56">
          <ResponsiveContainer>
            <BarChart data={d.daily} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barCategoryGap={d.days > 90 ? 0 : 2}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={24} />
              <YAxis {...axisProps} allowDecimals={false} width={40} />
              <Tooltip cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} content={<ChartTooltip formatLabel={(l) => shortDate(l)} />} />
              {hasMethod ? (
                <>
                  <Bar dataKey="direct" name="Direct" stackId="m" fill={DIRECT} stroke="var(--color-surface)" strokeWidth={1} />
                  <Bar dataKey="transcode" name="Transcode" stackId="m" fill={TRANSCODE} radius={[4, 4, 0, 0]} stroke="var(--color-surface)" strokeWidth={1} />
                </>
              ) : (
                <Bar dataKey="plays" name="Plays" fill={SERIES.plays} radius={[4, 4, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function Heatmap({ d }: { d: PlaybackStats }) {
  const max = Math.max(1, ...d.heatmap.flat());
  return (
    <Card>
      <CardHeader icon={Clock} accent={SERIES.plays} title="When people watch" subtitle="Plays started, by weekday and hour" />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-[2px] text-[10px] text-ink-4">
            <caption className="sr-only">Plays started by weekday and hour</caption>
            <thead>
              <tr>
                <th className="w-9" />
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} scope="col" className="font-normal">{h % 3 === 0 ? h : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.heatmap.map((row, w) => (
                <tr key={w}>
                  <th scope="row" className="pr-1.5 text-left font-normal">{DAYS[w]}</th>
                  {row.map((n, h) => (
                    <td
                      key={h}
                      title={`${DAYS[w]} ${h}:00–${h + 1}:00 · ${n} play${n === 1 ? '' : 's'}`}
                      className="h-5 rounded-[3px]"
                      style={{ background: n ? `color-mix(in oklab, ${SERIES.plays} ${Math.round(15 + (n / max) * 85)}%, transparent)` : 'rgb(255 255 255 / 0.03)' }}
                    >
                      <span className="sr-only">{n}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-ink-4">
          Fewer
          {[15, 40, 70, 100].map((p) => <span key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, ${SERIES.plays} ${p}%, transparent)` }} />)}
          More
        </div>
      </CardBody>
    </Card>
  );
}

function TopList({ title, icon, rows, hours, linkFor }: { title: string; icon: typeof Users; rows: (PlaybackStats['topUsers'][number] & { link?: string })[]; hours: boolean; linkFor?: (r: { name: string; link?: string }) => string | undefined }) {
  const max = Math.max(1, ...rows.map((r) => (hours ? r.hours : r.plays)));
  return (
    <Card className="h-full">
      <CardHeader icon={icon} title={title} subtitle={hours ? 'By watch time' : 'By plays'} />
      <CardBody>
        {rows.length ? (
          <ol className="space-y-2.5">
            {rows.map((r) => {
              const v = hours ? r.hours : r.plays;
              return (
                <li key={r.name}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    {linkFor?.(r) ? (
                      <Link to={linkFor(r)!} className="truncate transition hover:text-brand focus-visible:text-brand">{r.name}</Link>
                    ) : (
                      <span className="truncate">{r.name}</span>
                    )}
                    <span className="shrink-0 text-xs text-ink-3 tabular">
                      {hours ? `${r.hours} h · ` : ''}{r.plays} play{r.plays === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: SERIES.plays }} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState icon={icon} title="Nothing yet" />
        )}
      </CardBody>
    </Card>
  );
}

export default function StatsPage() {
  const [days, setDays] = useState<number>(30);
  const [server, setServer] = useState('');
  const q = usePlaybackStats(days, server);
  const servers = q.data?.servers ?? [];
  const several = servers.length > 1;
  const picked = servers.find((x) => x.id === server);
  const main = useMainServer();
  const { user } = useAuth();
  return (
    <>
      <PageHeader
        eyebrow={several ? (picked ? `${picked.name} · ${SERVER_NAME[picked.type]}` : 'All media servers') : main.name}
        title="Playback stats"
        description="Who watches what, when, and how it gets to them."
        actions={
          <div role="radiogroup" aria-label="Period" className="flex gap-1 rounded-xl border border-line p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={days === r}
                onClick={() => setDays(r)}
                className={cn('h-7 rounded-lg px-2.5 text-xs font-medium transition', days === r ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:text-ink-2')}
              >
                {r === 365 ? '1 year' : `${r} days`}
              </button>
            ))}
          </div>
        }
      />
      <QueryState query={q} skeleton={<PageLoader label="Crunching playback stats" hint="Adding up plays and watch time…" />}>
        {(d) => {
          const hours = d.totals.hours !== undefined;
          return (
            <div className="space-y-5">
              {several && (
                <div role="tablist" aria-label="Media server" className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-ink-4">Played on</span>
                  {[{ id: '', name: 'All servers', type: undefined, plays: d.servers.reduce((n, x) => n + x.plays, 0) }, ...d.servers].map((x) => (
                    <button
                      key={x.id || '*'}
                      role="tab"
                      aria-selected={server === x.id}
                      onClick={() => setServer(x.id)}
                      className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition', server === x.id ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2')}
                    >
                      {x.type ? <ServerTag type={x.type} name={x.name} /> : x.name}
                      <span className="text-ink-4 tabular">{x.plays}</span>
                    </button>
                  ))}
                </div>
              )}
              {(d.source !== 'recorder' || !d.recording) && (
                <p className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-xs text-ink-3">
                  {!d.recording
                    ? 'Add a Jellyfin API key in Settings to record watch time and direct-play vs transcode. Until then these figures come from the Jellyfin activity log.'
                    : `Watch time and transcode figures are recorded from ${d.recordingSince ? new Date(d.recordingSince).toLocaleDateString() : 'now'} onwards; earlier days come from the Jellyfin activity log.`}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Plays" value={d.totals.plays} icon={Play} accent={SERIES.plays} />
                <StatTile label="Watch time" value={d.totals.hours ?? 0} icon={Clock} accent={SERIES.plays} format={(n) => (hours ? `${Math.round(n)} h` : '—')} />
                <StatTile label="Viewers" value={d.totals.users} icon={Users} accent={SERIES.plays} />
                <StatTile
                  label="Transcoded"
                  value={(d.totals.transcodeShare ?? 0) * 100}
                  icon={Repeat2}
                  accent={TRANSCODE}
                  format={(n) => (d.totals.transcodeShare === undefined ? '—' : pct(n / 100))}
                  hint="Share of plays that transcoded"
                />
              </div>
              <DailyChart d={d} />
              <div className="grid gap-5 xl:grid-cols-3">
                <TopList title="Top viewers" icon={Users} rows={d.topUsers} hours={hours} linkFor={user?.isAdmin ? (r) => `/history?user=${encodeURIComponent(r.name)}&days=${d.days}${d.server ? `&server=${encodeURIComponent(d.server)}` : ''}` : undefined} />
                <TopList title="Most watched" icon={Play} rows={d.topTitles} hours={hours} linkFor={(r) => r.link} />
                <TopList title="Clients" icon={MonitorSmartphone} rows={d.topClients} hours={hours} />
              </div>
              <Heatmap d={d} />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

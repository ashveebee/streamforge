import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { BarChart3, Clock, MonitorSmartphone, Play, Repeat2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMainServer, usePlaybackStats } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { ServerTag, SERVER_COLOR, SERVER_NAME } from '@/components/ui/ServerTag';
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

type Servers = PlaybackStats['servers'];

/**
 * Each server's colour: purple Jellyfin, amber Plex, green Emby. A second or
 * third server of the same kind gets a lighter or darker shade so they still differ.
 */
function serverColors(servers: Servers) {
  const seen: Record<string, number> = {};
  const out: Record<string, string> = {};
  for (const x of servers) {
    const n = (seen[x.type] = (seen[x.type] ?? 0) + 1) - 1;
    const base = SERVER_COLOR[x.type];
    out[x.id] = n === 0 ? base : n % 2 ? `color-mix(in oklab, ${base} 60%, white)` : `color-mix(in oklab, ${base} 60%, black)`;
  }
  return out;
}

/** A bar split into each server's share, in the server colours. */
function ServerSplit({ byServer, servers, colors, width }: { byServer: Record<string, number>; servers: Servers; colors: Record<string, string>; width: number }) {
  const total = Object.values(byServer).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${width}%` }}>
      {servers.map((x) =>
        byServer[x.id] ? <div key={x.id} title={`${x.name}: ${byServer[x.id]}`} className="h-full" style={{ width: `${(byServer[x.id]! / total) * 100}%`, background: colors[x.id] }} /> : null,
      )}
    </div>
  );
}

const shortDate = (d: string | number) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function DailyChart({ d, colors, accent }: { d: PlaybackStats; colors: Record<string, string>; accent: string }) {
  const main = useMainServer();
  const hasMethod = d.daily.some((x) => x.direct || x.transcode);
  // With several servers and none picked, the bars are split by server; delivery is the other view.
  const canSplit = d.servers.length > 1 && !d.server;
  const [view, setView] = useState<'servers' | 'delivery'>('servers');
  const mode = canSplit && (view === 'servers' || !hasMethod) ? 'servers' : hasMethod ? 'delivery' : 'plays';
  const subtitle =
    mode === 'servers'
      ? 'Split by the server it was played on'
      : mode === 'delivery'
        ? 'Split by how the stream was delivered'
        : d.servers.length > 1
          ? 'From the server’s own history'
          : main.plex
            ? 'From Plex watch history'
            : `From the ${main.name} activity log`;
  return (
    <Card>
      <CardHeader
        icon={BarChart3}
        accent={accent}
        title="Plays per day"
        subtitle={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-3">
            {mode === 'servers' && <Legend items={d.servers.map((x) => ({ label: x.name, color: colors[x.id]! }))} />}
            {mode === 'delivery' && <Legend items={[{ label: 'Direct', color: DIRECT }, { label: 'Transcode', color: TRANSCODE }]} />}
            {canSplit && hasMethod && (
              <div role="radiogroup" aria-label="Split by" className="flex gap-0.5 rounded-lg border border-line p-0.5">
                {(['servers', 'delivery'] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={view === v}
                    onClick={() => setView(v)}
                    className={cn('h-6 rounded-md px-2 text-[11px] font-medium transition', view === v ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:text-ink-2')}
                  >
                    {v === 'servers' ? 'Servers' : 'Delivery'}
                  </button>
                ))}
              </div>
            )}
          </div>
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
              {mode === 'servers' ? (
                d.servers.map((x, i) => (
                  <Bar
                    key={x.id}
                    dataKey={(r: PlaybackStats['daily'][number]) => r.byServer?.[x.id] ?? 0}
                    name={x.name}
                    stackId="s"
                    fill={colors[x.id]}
                    radius={i === d.servers.length - 1 ? [4, 4, 0, 0] : undefined}
                    stroke="var(--color-surface)"
                    strokeWidth={1}
                  />
                ))
              ) : mode === 'delivery' ? (
                <>
                  <Bar dataKey="direct" name="Direct" stackId="m" fill={DIRECT} stroke="var(--color-surface)" strokeWidth={1} />
                  <Bar dataKey="transcode" name="Transcode" stackId="m" fill={TRANSCODE} radius={[4, 4, 0, 0]} stroke="var(--color-surface)" strokeWidth={1} />
                </>
              ) : (
                <Bar dataKey="plays" name="Plays" fill={accent} radius={[4, 4, 0, 0]} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

function Heatmap({ d, accent }: { d: PlaybackStats; accent: string }) {
  const max = Math.max(1, ...d.heatmap.flat());
  return (
    <Card>
      <CardHeader icon={Clock} accent={accent} title="When people watch" subtitle="Plays started, by weekday and hour" />
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
                      style={{ background: n ? `color-mix(in oklab, ${accent} ${Math.round(15 + (n / max) * 85)}%, transparent)` : 'rgb(255 255 255 / 0.03)' }}
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
          {[15, 40, 70, 100].map((p) => <span key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, ${accent} ${p}%, transparent)` }} />)}
          More
        </div>
      </CardBody>
    </Card>
  );
}

function TopList({
  title,
  icon,
  rows,
  hours,
  linkFor,
  accent,
  split,
}: {
  title: string;
  icon: typeof Users;
  rows: (PlaybackStats['topUsers'][number] & { link?: string })[];
  hours: boolean;
  linkFor?: (r: { name: string; link?: string }) => string | undefined;
  accent: string;
  /** Several servers, none picked: each bar is split by server. */
  split?: { servers: Servers; colors: Record<string, string> };
}) {
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
                    {split ? (
                      <ServerSplit byServer={r.byServer ?? {}} servers={split.servers} colors={split.colors} width={(v / max) * 100} />
                    ) : (
                      <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: accent }} />
                    )}
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
          const colors = serverColors(d.servers);
          // A picked server tints the page in its colour.
          const accent = d.server && colors[d.server] ? colors[d.server]! : SERIES.plays;
          const split = d.servers.length > 1 && !d.server ? { servers: d.servers, colors } : undefined;
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
                      style={
                        server === x.id && x.id && colors[x.id]
                          ? { borderColor: `color-mix(in oklab, ${colors[x.id]} 55%, transparent)`, background: `color-mix(in oklab, ${colors[x.id]} 14%, transparent)` }
                          : undefined
                      }
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
                    : `Watch time and transcode figures are recorded from ${d.recordingSince ? new Date(d.recordingSince).toLocaleDateString() : 'now'} onwards; earlier days come from ${d.servers.length > 1 ? 'each server’s own history' : d.servers[0]?.type === 'plex' ? 'Plex watch history' : 'the server’s activity log'}.`}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Plays" value={d.totals.plays} icon={Play} accent={accent} />
                <StatTile label="Watch time" value={d.totals.hours ?? 0} icon={Clock} accent={accent} format={(n) => (hours ? `${Math.round(n)} h` : '—')} />
                <StatTile label="Viewers" value={d.totals.users} icon={Users} accent={accent} />
                <StatTile
                  label="Transcoded"
                  value={(d.totals.transcodeShare ?? 0) * 100}
                  icon={Repeat2}
                  accent={TRANSCODE}
                  format={(n) => (d.totals.transcodeShare === undefined ? '—' : pct(n / 100))}
                  hint="Share of plays that transcoded"
                />
              </div>
              <DailyChart d={d} colors={colors} accent={accent} />
              <div className="grid gap-5 xl:grid-cols-3">
                <TopList title="Top viewers" icon={Users} rows={d.topUsers} hours={hours} accent={accent} split={split} linkFor={user?.isAdmin ? (r) => `/history?user=${encodeURIComponent(r.name)}&days=${d.days}${d.server ? `&server=${encodeURIComponent(d.server)}` : ''}` : undefined} />
                <TopList title="Most watched" icon={Play} rows={d.topTitles} hours={hours} accent={accent} split={split} linkFor={(r) => r.link} />
                <TopList title="Clients" icon={MonitorSmartphone} rows={d.topClients} hours={hours} accent={accent} split={split} />
              </div>
              <Heatmap d={d} accent={accent} />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

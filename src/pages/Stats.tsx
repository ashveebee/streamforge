import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { BarChart3, Clock, MonitorSmartphone, Play, Repeat2, Users } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMainServer, usePlaybackStats } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import { SERVER_COLOR } from '@/components/ui/ServerTag';
import { pct, weekdays } from '@/lib/format';
import type { PlaybackStats } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { axisProps, ChartTooltip, gridProps, Legend, SERIES } from '@/components/ui/Chart';
import { StatTile } from '@/components/ui/Stat';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { getLocale, useT } from '@/i18n';

const RANGES = [7, 30, 90, 365] as const;
// Validated two-series pair (same as Sonarr/Radarr elsewhere).
const DIRECT = SERIES.sonarr;
const TRANSCODE = SERIES.radarr;

const shortDate = (d: string | number) => new Date(`${d}T12:00:00`).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });

function DailyChart({ d, accent }: { d: PlaybackStats; accent: string }) {
  const main = useMainServer();
  const t = useT();
  const hasMethod = d.daily.some((x) => x.direct || x.transcode);
  return (
    <Card>
      <CardHeader
        icon={BarChart3}
        accent={accent}
        title={t('watch.stats.perDay')}
        subtitle={hasMethod ? t('watch.stats.split') : main.plex ? t('watch.history.fromPlex') : t('watch.history.fromLog', { server: main.name })}
        action={hasMethod ? <Legend items={[{ label: t('watch.stats.direct'), color: DIRECT }, { label: t('ui.method.transcode'), color: TRANSCODE }]} /> : undefined}
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
                  <Bar dataKey="direct" name={t('watch.stats.direct')} stackId="m" fill={DIRECT} stroke="var(--color-surface)" strokeWidth={1} />
                  <Bar dataKey="transcode" name={t('ui.method.transcode')} stackId="m" fill={TRANSCODE} radius={[4, 4, 0, 0]} stroke="var(--color-surface)" strokeWidth={1} />
                </>
              ) : (
                <Bar dataKey="plays" name={t('widgets.plays.label')} fill={accent} radius={[4, 4, 0, 0]} />
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
  const t = useT();
  // Rows run Monday to Sunday.
  const days = weekdays('short');
  const DAYS = [...days.slice(1), days[0]!];
  return (
    <Card>
      <CardHeader icon={Clock} accent={accent} title={t('watch.stats.when')} subtitle={t('watch.stats.whenHint')} />
      <CardBody>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] table-fixed border-separate border-spacing-[2px] text-[10px] text-ink-4">
            <caption className="sr-only">{t('watch.stats.whenHint')}</caption>
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
                      title={`${DAYS[w]} ${h}:00–${h + 1}:00 · ${t('widgets.plays.plays', { count: n })}`}
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
          {t('watch.stats.fewer')}
          {[15, 40, 70, 100].map((p) => <span key={p} className="size-3 rounded-[3px]" style={{ background: `color-mix(in oklab, ${accent} ${p}%, transparent)` }} />)}
          {t('watch.stats.more')}
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
}: {
  title: string;
  icon: typeof Users;
  rows: (PlaybackStats['topUsers'][number] & { link?: string })[];
  hours: boolean;
  linkFor?: (r: { name: string; link?: string }) => string | undefined;
  accent: string;
}) {
  const max = Math.max(1, ...rows.map((r) => (hours ? r.hours : r.plays)));
  const t = useT();
  return (
    <Card className="h-full">
      <CardHeader icon={icon} title={title} subtitle={hours ? t('watch.stats.byTime') : t('watch.stats.byPlays')} />
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
                      {hours ? `${t('watch.stats.hours', { n: r.hours })} · ` : ''}{t('widgets.plays.plays', { count: r.plays })}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: accent }} />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState icon={icon} title={t('watch.stats.nothing')} />
        )}
      </CardBody>
    </Card>
  );
}

export default function StatsPage() {
  const [days, setDays] = useState<number>(30);
  const q = usePlaybackStats(days);
  const main = useMainServer();
  // The media server's colour: purple Jellyfin, amber Plex, green Emby.
  const accent = SERVER_COLOR[main.type];
  const { user } = useAuth();
  const t = useT();
  return (
    <>
      <PageHeader
        eyebrow={main.name}
        title={t('watch.stats.title')}
        description={t('watch.stats.description')}
        actions={
          <div role="radiogroup" aria-label={t('watch.stats.period')} className="flex gap-1 rounded-xl border border-line p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={days === r}
                onClick={() => setDays(r)}
                className={cn('h-7 rounded-lg px-2.5 text-xs font-medium transition', days === r ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:text-ink-2')}
              >
                {r === 365 ? t('widgets.reclaim.years', { count: 1 }) : t('widgets.forecast.days', { count: r })}
              </button>
            ))}
          </div>
        }
      />
      <QueryState query={q} skeleton={<PageLoader label={t('watch.stats.loading')} hint={t('watch.stats.loadingHint')} />}>
        {(d) => {
          const hours = d.totals.hours !== undefined;
          return (
            <div className="space-y-5">
              {(d.source !== 'recorder' || !d.recording) && (
                <p className="rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-xs text-ink-3">
                  {!d.recording
                    ? t('watch.stats.needsKey')
                    : t('watch.stats.recordedFrom', {
                        since: d.recordingSince ? new Date(d.recordingSince).toLocaleDateString(getLocale()) : t('watch.stats.now'),
                        source: main.plex ? t('watch.history.fromPlex') : t('watch.history.fromLog', { server: main.name }),
                      })}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label={t('widgets.plays.label')} value={d.totals.plays} icon={Play} accent={accent} />
                <StatTile label={t('watch.stats.watchTime')} value={d.totals.hours ?? 0} icon={Clock} accent={accent} format={(n) => (hours ? t('watch.stats.hours', { n: Math.round(n) }) : '—')} />
                <StatTile label={t('watch.stats.viewers')} value={d.totals.users} icon={Users} accent={accent} />
                <StatTile
                  label={t('me.transcoded')}
                  value={(d.totals.transcodeShare ?? 0) * 100}
                  icon={Repeat2}
                  accent={TRANSCODE}
                  format={(n) => (d.totals.transcodeShare === undefined ? '—' : pct(n / 100))}
                  hint={t('watch.stats.share')}
                />
              </div>
              <DailyChart d={d} accent={accent} />
              <div className="grid gap-5 xl:grid-cols-3">
                <TopList title={t('watch.stats.topViewers')} icon={Users} rows={d.topUsers} hours={hours} accent={accent} linkFor={user?.isAdmin ? (r) => `/history?user=${encodeURIComponent(r.name)}&days=${d.days}` : undefined} />
                <TopList title={t('watch.stats.mostWatched')} icon={Play} rows={d.topTitles} hours={hours} accent={accent} linkFor={(r) => r.link} />
                <TopList title={t('watch.stats.clients')} icon={MonitorSmartphone} rows={d.topClients} hours={hours} accent={accent} />
              </div>
              <Heatmap d={d} accent={accent} />
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

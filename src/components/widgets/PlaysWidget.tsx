import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { usePlays } from '@/hooks/queries';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { axisProps, ChartTooltip, gridProps, SERIES } from '../ui/Chart';
import { QueryState, Skeleton } from '../ui/States';
import { getLocale } from '@/i18n';

const short = (d: string | number) => new Date(`${d}T12:00:00`).toLocaleDateString(getLocale(), { weekday: 'short' }).slice(0, 2);
const long = (d: string | number) => new Date(`${d}T12:00:00`).toLocaleDateString(getLocale(), { weekday: 'long', month: 'short', day: 'numeric' });

export function PlaysWidget() {
  const q = usePlays();
  return (
    <Card className="h-full">
      <CardHeader icon={BarChart3} accent="var(--color-jellyfin)" title="Playback activity" subtitle="Plays per day · last 14 days" />
      <CardBody>
        <QueryState query={q} skeleton={<Skeleton className="h-48" />}>
          {(data) => {
            const total = data.reduce((a, d) => a + d.plays, 0);
            const busiest = data.reduce((m, d) => (d.plays > m.plays ? d : m), data[0] ?? { plays: 0, date: '' });
            return (
              <>
                <div className="mb-3 flex items-baseline gap-3">
                  <span className="text-3xl font-semibold tabular">{total.toLocaleString(getLocale())}</span>
                  <span className="text-xs text-ink-3">plays{busiest?.plays ? ` · busiest ${long(busiest.date)}` : ''}</span>
                </div>
                <div className="h-44">
                  <ResponsiveContainer>
                    <BarChart data={data} margin={{ top: 4, right: 0, left: -24, bottom: 0 }} barCategoryGap="22%">
                      <defs>
                        <linearGradient id="g-plays" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a78bfa" />
                          <stop offset="100%" stopColor={SERIES.plays} stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} tickFormatter={short} interval={0} />
                      <YAxis {...axisProps} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: 'rgb(255 255 255 / 0.04)', radius: 6 }}
                        content={<ChartTooltip formatLabel={long} formatValue={(v, k) => (k === 'plays' ? `${v} plays` : `${v}`)} />}
                      />
                      <Bar dataKey="plays" name="Plays" fill="url(#g-plays)" radius={[4, 4, 0, 0]} isAnimationActive />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            );
          }}
        </QueryState>
      </CardBody>
    </Card>
  );
}

import { CheckCircle2, Clock, Film, Inbox, Loader, Tv, XCircle } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useSeerr, useServiceConfig } from '@/hooks/queries';
import { PageHeader } from '@/components/layout/PageHeader';
import { ServiceIcon } from '@/components/ui/ServiceIcon';
import { relative } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ChartTooltip, Legend } from '@/components/ui/Chart';
import { FadeImage } from '@/components/ui/Image';
import { StatTile } from '@/components/ui/Stat';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { RequestDecision, RequestRow } from '@/components/widgets/RequestsWidget';
import { TitleLink } from '@/components/ui/TitleLink';
import { t, useT } from '@/i18n';

// Two-slice categorical split; validated pair.
const SPLIT = [
  { key: 'movie', get label() { return t('widgets.library.movies'); }, color: '#0284c7' },
  { key: 'tv', get label() { return t('widgets.library.series'); }, color: '#d97706' },
] as const;

export default function SeerrPage() {
  const q = useSeerr();
  const t = useT();
  const silo = useServiceConfig().data?.requests === 'silo';
  return (
    <>
      {/* With Silo's own requests, this page shows those instead of Seerr's. */}
      {silo ? (
        <PageHeader icon={<ServiceIcon id="silo" size={52} />} eyebrow="Silo" title={t('nav.requests')} description={t('library.requests.silo')} />
      ) : (
        <ServiceHeader id="seerr" />
      )}
      <QueryState query={q} skeleton={<PageLoader label={t('library.requests.loading')} hint={t('library.requests.asking', { server: silo ? 'Silo' : 'Seerr' })} />}>
        {(d) => {
          const split = SPLIT.map((s) => ({ name: s.label, value: d.counts[s.key], color: s.color }));
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <StatTile label={t('library.requests.total')} value={d.counts.total} icon={Inbox} accent="var(--color-seerr)" />
                <StatTile label={t('ui.request.pending')} value={d.counts.pending} icon={Clock} accent="var(--color-warn)" hint={t('library.requests.awaiting')} />
                <StatTile label={t('ui.request.approved')} value={d.counts.approved} icon={CheckCircle2} accent="var(--color-ok)" />
                <StatTile label={t('ui.request.processing')} value={d.counts.processing} icon={Loader} accent="var(--color-sonarr)" hint={t('library.requests.processingHint')} />
                <StatTile label={t('ui.request.declined')} value={d.counts.declined} icon={XCircle} accent="var(--color-bad)" className="col-span-2 lg:col-span-1" />
              </div>

              <div className="grid gap-5 xl:grid-cols-3">
                <Card className="xl:col-span-2">
                  <CardHeader icon={Clock} accent="var(--color-warn)" title={t('library.requests.awaiting')} subtitle={t('library.requests.pending', { count: d.counts.pending })} />
                  <CardBody>
                    {d.pending.length ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {d.pending.map((r) => (
                          <div key={r.id} className="group relative overflow-hidden rounded-2xl border border-line">
                            <FadeImage src={r.backdrop} alt="" className="absolute inset-0 opacity-40" />
                            <div className="absolute inset-0 bg-gradient-to-r from-surface via-surface/85 to-surface/40" />
                            <div className="relative flex gap-3 p-3">
                              <FadeImage src={r.poster} alt={r.title} className="aspect-[2/3] w-16 shrink-0 rounded-lg ring-1 ring-white/10" />
                              <div className="min-w-0 flex-1">
                                <TitleLink to={r.tmdbId ? `/media/${r.type}/${r.tmdbId}` : undefined} className="block truncate text-sm font-semibold">{r.title}</TitleLink>
                                <div className="text-[11px] text-ink-3">{r.year} · {r.type === 'tv' ? t('me.series') : t('me.movie')}{r.is4k ? ' · 4K' : ''}</div>
                                <div className="mt-2 text-[11px] text-ink-4">{t('library.requests.by')} <span className="text-ink-2">{r.requestedBy}</span></div>
                                <div className="text-[11px] text-ink-4">{relative(r.createdAt)}</div>
                                <div className="mt-2"><RequestDecision r={r} /></div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState icon={CheckCircle2} title={t('library.requests.caughtUp')} description={t('library.requests.caughtUpHint')} />
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader icon={Inbox} title={t('library.requests.mix')} subtitle={t('library.requests.mixHint')} />
                  <CardBody>
                    {d.counts.total ? (
                      <>
                        <div className="relative h-48">
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie data={split} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="92%" paddingAngle={3} cornerRadius={6} stroke="var(--color-surface)" strokeWidth={2}>
                                {split.map((s) => <Cell key={s.name} fill={s.color} />)}
                              </Pie>
                              <Tooltip content={<ChartTooltip />} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                            <div><div className="text-2xl font-semibold tabular">{d.counts.total}</div><div className="text-[11px] text-ink-4">{t('library.requests.requests')}</div></div>
                          </div>
                        </div>
                        <div className="mt-3 flex justify-center">
                          <Legend items={[
                            { label: t('widgets.library.movies'), color: SPLIT[0].color, value: <span className="inline-flex items-center gap-1"><Film className="size-3" />{d.counts.movie}</span> },
                            { label: t('widgets.library.series'), color: SPLIT[1].color, value: <span className="inline-flex items-center gap-1"><Tv className="size-3" />{d.counts.tv}</span> },
                          ]} />
                        </div>
                        <div className="mt-4 text-center text-xs text-ink-3">{t('library.requests.available', { count: d.counts.available })}</div>
                      </>
                    ) : (
                      <EmptyState icon={Inbox} title={t('me.noRequests')} />
                    )}
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader icon={Inbox} title={t('library.requests.recent')} />
                <CardBody>
                  {d.recent.length ? (
                    <ul className="grid gap-x-8 md:grid-cols-2 [&>li]:border-b [&>li]:border-line">
                      {d.recent.map((r) => <RequestRow key={r.id} r={r} />)}
                    </ul>
                  ) : (
                    <EmptyState icon={Inbox} title={t('me.noRequests')} />
                  )}
                </CardBody>
              </Card>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

import { Activity, AppWindow, CheckCircle2, Download, Radar, Search, Timer } from 'lucide-react';
import { useProwlarr } from '@/hooks/queries';
import { compact, pct, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { INDEXER_TONE } from '@/components/widgets/IndexersWidget';
import { t } from '@/i18n';

export default function ProwlarrPage() {
  const q = useProwlarr();
  return (
    <>
      <ServiceHeader id="prowlarr" />
      <QueryState query={q} skeleton={<PageLoader label={t('svc.prowlarr.loading')} hint={t('svc.prowlarr.loadingHint')} />}>
        {(d) => {
          const maxMs = Math.max(1, ...d.indexers.map((i) => i.stats.avgResponseMs));
          return (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label={t('svc.prowlarr.healthy')} value={d.summary.healthy} icon={CheckCircle2} accent="var(--color-ok)" hint={t('svc.prowlarr.healthyHint', { failing: d.summary.failing, disabled: d.summary.disabled })} />
                <StatTile label={t('svc.prowlarr.queries')} value={d.summary.queries} icon={Search} accent="var(--color-prowlarr)" format={(n) => compact(Math.round(n))} hint={t('svc.prowlarr.failed', { n: compact(d.summary.failedQueries) })} />
                <StatTile label={t('svc.prowlarr.grabs')} value={d.summary.grabs} icon={Download} accent="var(--color-sonarr)" format={(n) => compact(Math.round(n))} hint={t('svc.prowlarr.failed', { n: compact(d.summary.failedGrabs) })} />
                <StatTile label={t('library.system.avg')} value={d.summary.avgResponseMs} icon={Timer} accent="var(--color-seerr)" format={(n) => `${Math.round(n)} ms`} hint={`${d.summary.torrent} torrent · ${d.summary.usenet} usenet`} />
              </div>

              <Card>
                <CardHeader icon={Radar} accent="var(--color-prowlarr)" title={t('dashboard.widgets.indexers')} subtitle={t('svc.prowlarr.configured', { n: d.summary.total })} />
                <CardBody className="px-0 pb-2">
                  {d.indexers.length === 0 ? (
                    <EmptyState icon={Radar} title={t('svc.prowlarr.none')} />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-[13px]">
                        <thead>
                          <tr className="border-y border-line text-left text-[11px] font-medium tracking-wide text-ink-4 uppercase">
                            <th className="px-5 py-2.5 font-medium">{t('svc.prowlarr.indexer')}</th>
                            <th className="px-3 py-2.5 font-medium">{t('library.system.status')}</th>
                            <th className="px-3 py-2.5 text-right font-medium">{t('svc.prowlarr.queries')}</th>
                            <th className="px-3 py-2.5 text-right font-medium">{t('svc.prowlarr.grabs')}</th>
                            <th className="px-3 py-2.5 text-right font-medium">{t('svc.prowlarr.success')}</th>
                            <th className="w-48 px-5 py-2.5 font-medium">{t('svc.prowlarr.responseTime')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {d.indexers.map((i) => {
                            const tone = INDEXER_TONE[i.health];
                            return (
                              <tr key={i.id} className="transition hover:bg-white/[0.02]">
                                <td className="px-5 py-3">
                                  <div className="font-medium">{i.name}</div>
                                  <div className="mt-0.5 flex gap-1">
                                    <Pill>{i.protocol}</Pill>
                                    {i.privacy && <Pill>{i.privacy}</Pill>}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <span className={cn('inline-flex items-center gap-1.5 font-medium', tone.cls)}>
                                    <span className={cn('size-1.5 rounded-full', tone.dot)} />
                                    {tone.label}
                                  </span>
                                  {i.disabledUntil && <div className="text-[11px] text-ink-4">{t('svc.prowlarr.retry', { when: relative(i.disabledUntil) })}</div>}
                                </td>
                                <td className="px-3 py-3 text-right tabular">{compact(i.stats.queries)}</td>
                                <td className="px-3 py-3 text-right tabular">{compact(i.stats.grabs)}</td>
                                <td className="px-3 py-3 text-right tabular">{i.stats.successRate !== undefined ? pct(i.stats.successRate, 1) : '—'}</td>
                                <td className="px-5 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                                      <div className="h-full rounded-full bg-gradient-to-r from-prowlarr/60 to-prowlarr" style={{ width: `${(i.stats.avgResponseMs / maxMs) * 100}%` }} />
                                    </div>
                                    <span className="w-14 text-right text-xs text-ink-3 tabular">{i.stats.avgResponseMs} ms</span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader icon={AppWindow} title={t('svc.prowlarr.apps')} subtitle={t('svc.prowlarr.appsHint')} />
                <CardBody>
                  {d.applications.length ? (
                    <div className="flex flex-wrap gap-2">
                      {d.applications.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                          <Activity className="size-3.5 text-ok" />
                          <span className="text-sm font-medium">{a.name}</span>
                          {a.syncLevel && <span className="text-[11px] text-ink-4">{a.syncLevel.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={AppWindow} title={t('svc.prowlarr.noApps')} className="py-4" />
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

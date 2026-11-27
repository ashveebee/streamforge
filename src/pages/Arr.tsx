import { CalendarDays, CheckCircle2, Download, Film, HardDrive, Layers, ListChecks, SearchX, Tv } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDownloads, useRadarr, useSonarr } from '@/hooks/queries';
import { bytes, compact } from '@/lib/format';
import type { DiskInfo, QueueItem } from '@/lib/types';
import { InstanceTabs, useSelectedInstance } from '@/components/layout/InstanceTabs';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { axisProps, ChartTooltip, gridProps } from '@/components/ui/Chart';
import { FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { EmptyState, QueryState } from '@/components/ui/States';
import { PageLoader } from '@/components/ui/Loader';
import { AutoImportCard } from '@/components/widgets/AutoImportCard';
import { MissingCard } from '@/components/widgets/MissingCard';
import { QueueRow } from '@/components/widgets/DownloadsWidget';
import { VolumeRow } from '@/components/widgets/StorageWidget';
import { UpcomingList } from '@/components/widgets/UpcomingWidget';
import { TitleLink, arrTitlePath } from '@/components/ui/TitleLink';
import { t } from '@/i18n';

function QueueCard({ items, total, accent }: { items: QueueItem[]; total: number; accent: string }) {
  const dl = useDownloads();
  return (
    <Card className="h-full">
      <CardHeader icon={Download} accent={accent} title={t('svc.queue')} subtitle={t('svc.queueSub', { count: total, remaining: bytes(items.reduce((a, i) => a + i.sizeLeft, 0)) })} />
      <CardBody>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <QueueRow key={i.id} item={i} speedBps={dl.data?.itemSpeeds[`${i.instance}:${i.id}`]} stalledSince={dl.data?.stalled?.[`${i.instance}:${i.id}`]} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={Download} title={t('widgets.downloads.empty')} description={t('widgets.downloads.emptyHint')} />
        )}
      </CardBody>
    </Card>
  );
}

function DisksCard({ disks }: { disks: DiskInfo[] }) {
  return (
    <Card className="h-full">
      <CardHeader icon={HardDrive} title={t('svc.disk')} subtitle={t('svc.diskHint')} />
      <CardBody>
        {disks.length ? (
          <ul className="divide-y divide-line">
            {disks.map((d) => (
              <VolumeRow key={d.path} v={{ id: d.path, name: d.label || d.path, mount: d.path, total: d.total, free: d.free, used: d.total - d.free, usage: d.total ? (d.total - d.free) / d.total : 0 }} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={HardDrive} title={t('svc.noDisks')} />
        )}
      </CardBody>
    </Card>
  );
}

function PosterStrip({ items, kind }: { kind: 'sonarr' | 'radarr'; items: { id: number; title: string; year?: number; poster?: string; caption?: string; progress?: number; tmdbId?: number }[] }) {
  return (
    <div className="flex gap-4 overflow-x-auto px-5 pb-5 no-scrollbar">
      {items.map((i) => (
        <TitleLink key={i.id} to={arrTitlePath(kind, i.tmdbId)} className="group block w-28 shrink-0 sm:w-32">
          <FadeImage src={i.poster} alt={i.title} className="aspect-[2/3] rounded-xl ring-1 ring-white/10 transition duration-500 group-hover:-translate-y-1 group-hover:ring-white/25" />
          {i.progress !== undefined && <ProgressBar value={i.progress} height={3} glow={false} className="mt-2" />}
          <div className="mt-1.5 truncate text-[13px] font-medium">{i.title}</div>
          <div className="truncate text-[11px] text-ink-3">{i.caption ?? i.year}</div>
        </TitleLink>
      ))}
    </div>
  );
}

const PageSkeleton = () => <PageLoader label={t('common.loading')} hint={t('svc.loadingHint')} />;

export function SonarrPage() {
  const instance = useSelectedInstance('sonarr');
  const q = useSonarr(instance);
  return (
    <>
      <ServiceHeader id="sonarr" instance={instance} />
      <InstanceTabs kind="sonarr" />
      <QueryState query={q} skeleton={<PageSkeleton />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('widgets.library.series')} value={d.stats.series} icon={Tv} accent="var(--color-sonarr)" hint={t('svc.seriesHint', { monitored: d.stats.monitored, continuing: d.stats.continuing })} />
              <StatTile label={t('svc.episodesOnDisk')} value={d.stats.episodeFiles} icon={CheckCircle2} accent="var(--color-ok)" format={(n) => compact(Math.round(n))} hint={t('svc.ofAired', { n: compact(d.stats.episodes) })} />
              <StatTile label={t('widgets.missing.title')} value={d.stats.missing} icon={SearchX} accent="var(--color-bad)" hint={t('widgets.missing.about')} />
              <StatTile label={t('svc.size')} value={d.stats.sizeOnDisk} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 [&>*]:min-w-0">
              <div className="xl:col-span-2"><QueueCard items={d.queue.items} total={d.queue.total} accent="var(--color-sonarr)" /></div>
              <Card className="h-full">
                <CardHeader icon={CalendarDays} accent="var(--color-sonarr)" title={t('svc.airing')} subtitle={t('svc.nextDays', { n: 14 })} />
                <CardBody className="max-h-[520px] overflow-y-auto"><UpcomingList items={d.upcoming} /></CardBody>
              </Card>
            </div>
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2 [&>*]:min-w-0">
              <AutoImportCard kind="sonarr" queue={d.queue.items} />
              <MissingCard kind="sonarr" instance={instance} />
            </div>
            <Card>
              <CardHeader icon={Layers} title={t('svc.recentSeries')} />
              <PosterStrip kind="sonarr" items={d.recent.map((r) => ({ ...r, caption: r.network ?? String(r.year ?? '') }))} />
            </Card>
            <DisksCard disks={d.disks} />
          </div>
        )}
      </QueryState>
    </>
  );
}

export function RadarrPage() {
  const instance = useSelectedInstance('radarr');
  const q = useRadarr(instance);
  return (
    <>
      <ServiceHeader id="radarr" instance={instance} />
      <InstanceTabs kind="radarr" />
      <QueryState query={q} skeleton={<PageSkeleton />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('widgets.library.movies')} value={d.stats.movies} icon={Film} accent="var(--color-radarr)" hint={t('svc.monitored', { n: d.stats.monitored })} />
              <StatTile label={t('palette.status.downloaded')} value={d.stats.downloaded} icon={CheckCircle2} accent="var(--color-ok)" hint={d.stats.movies ? t('svc.ofLibrary', { pct: Math.round((d.stats.downloaded / d.stats.movies) * 100) }) : undefined} />
              <StatTile label={t('widgets.missing.title')} value={d.stats.missing} icon={SearchX} accent="var(--color-bad)" hint={t('svc.unreleased', { n: d.stats.unreleased })} />
              <StatTile label={t('svc.size')} value={d.stats.sizeOnDisk} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 [&>*]:min-w-0">
              <div className="xl:col-span-2"><QueueCard items={d.queue.items} total={d.queue.total} accent="var(--color-radarr)" /></div>
              <Card className="h-full">
                <CardHeader icon={CalendarDays} accent="var(--color-radarr)" title={t('svc.upcoming')} subtitle={t('svc.nextDays', { n: 30 })} />
                <CardBody className="max-h-[520px] overflow-y-auto"><UpcomingList items={d.upcoming} /></CardBody>
              </Card>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 [&>*]:min-w-0">
              <Card className="xl:col-span-2">
                <CardHeader icon={Layers} title={t('svc.recentMovies')} />
                <PosterStrip kind="radarr" items={d.recent.map((r) => ({ ...r, caption: `${r.year ?? ''} · ${r.hasFile ? t('svc.onDisk') : t('palette.status.missing')}` }))} />
              </Card>
              <Card>
                <CardHeader icon={ListChecks} title={t('svc.quality')} subtitle={t('svc.qualityHint')} />
                <CardBody>
                  {d.qualities.length ? (
                    <div style={{ height: Math.max(120, d.qualities.length * 30) }}>
                      <ResponsiveContainer>
                        <BarChart data={d.qualities} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}>
                          <CartesianGrid {...gridProps} horizontal={false} vertical />
                          <XAxis type="number" {...axisProps} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" {...axisProps} width={96} tick={{ fill: 'var(--color-ink-3)', fontSize: 11 }} />
                          <Tooltip cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} content={<ChartTooltip formatValue={(v) => t('media.add.movies', { count: v })} />} />
                          <Bar dataKey="count" name={t('widgets.library.movies')} radius={[0, 4, 4, 0]}>
                            {d.qualities.map((q) => <Cell key={q.name} fill="#d97706" />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState icon={ListChecks} title={t('svc.noFiles')} />
                  )}
                </CardBody>
              </Card>
            </div>
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2 [&>*]:min-w-0">
              <AutoImportCard kind="radarr" queue={d.queue.items} />
              <MissingCard kind="radarr" instance={instance} />
            </div>
            <DisksCard disks={d.disks} />
          </div>
        )}
      </QueryState>
    </>
  );
}

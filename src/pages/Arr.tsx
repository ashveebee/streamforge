import { CalendarDays, CheckCircle2, Download, Film, HardDrive, Layers, ListChecks, SearchX, Tv } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useDownloads, useRadarr, useSonarr } from '@/hooks/queries';
import { bytes, compact } from '@/lib/format';
import type { DiskInfo, QueueItem } from '@/lib/types';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { axisProps, ChartTooltip, gridProps } from '@/components/ui/Chart';
import { FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { EmptyState, QueryState, Skeleton } from '@/components/ui/States';
import { AutoImportCard } from '@/components/widgets/AutoImportCard';
import { QueueRow } from '@/components/widgets/DownloadsWidget';
import { VolumeRow } from '@/components/widgets/StorageWidget';
import { UpcomingList } from '@/components/widgets/UpcomingWidget';

function QueueCard({ items, total, accent }: { items: QueueItem[]; total: number; accent: string }) {
  const dl = useDownloads();
  return (
    <Card className="h-full">
      <CardHeader icon={Download} accent={accent} title="Queue" subtitle={`${total} items · ${bytes(items.reduce((a, i) => a + i.sizeLeft, 0))} remaining`} />
      <CardBody>
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((i) => <QueueRow key={i.id} item={i} speedBps={dl.data?.itemSpeeds[`${i.source}:${i.id}`]} />)}
          </ul>
        ) : (
          <EmptyState icon={Download} title="Queue is empty" description="Nothing downloading right now." />
        )}
      </CardBody>
    </Card>
  );
}

function DisksCard({ disks }: { disks: DiskInfo[] }) {
  return (
    <Card className="h-full">
      <CardHeader icon={HardDrive} title="Disk space" subtitle="As reported by the service" />
      <CardBody>
        {disks.length ? (
          <ul className="divide-y divide-line">
            {disks.map((d) => (
              <VolumeRow key={d.path} v={{ id: d.path, name: d.label || d.path, mount: d.path, total: d.total, free: d.free, used: d.total - d.free, usage: d.total ? (d.total - d.free) / d.total : 0 }} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={HardDrive} title="No disks reported" />
        )}
      </CardBody>
    </Card>
  );
}

function PosterStrip({ items }: { items: { id: number; title: string; year?: number; poster?: string; caption?: string; progress?: number }[] }) {
  return (
    <div className="flex gap-4 overflow-x-auto px-5 pb-5 no-scrollbar">
      {items.map((i) => (
        <div key={i.id} className="group w-28 shrink-0 sm:w-32">
          <FadeImage src={i.poster} alt={i.title} className="aspect-[2/3] rounded-xl ring-1 ring-white/10 transition duration-500 group-hover:-translate-y-1 group-hover:ring-white/25" />
          {i.progress !== undefined && <ProgressBar value={i.progress} height={3} glow={false} className="mt-2" />}
          <div className="mt-1.5 truncate text-[13px] font-medium">{i.title}</div>
          <div className="truncate text-[11px] text-ink-3">{i.caption ?? i.year}</div>
        </div>
      ))}
    </div>
  );
}

const pageSkeleton = (
  <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
    <Skeleton className="h-80 rounded-[1.25rem]" />
  </div>
);

export function SonarrPage() {
  const q = useSonarr();
  return (
    <>
      <ServiceHeader id="sonarr" />
      <QueryState query={q} skeleton={pageSkeleton}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Series" value={d.stats.series} icon={Tv} accent="var(--color-sonarr)" hint={`${d.stats.monitored} monitored · ${d.stats.continuing} continuing`} />
              <StatTile label="Episodes on disk" value={d.stats.episodeFiles} icon={CheckCircle2} accent="var(--color-ok)" format={(n) => compact(Math.round(n))} hint={`of ${compact(d.stats.episodes)} aired`} />
              <StatTile label="Missing" value={d.stats.missing} icon={SearchX} accent="var(--color-bad)" hint="Monitored, not downloaded" />
              <StatTile label="Size on disk" value={d.stats.sizeOnDisk} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="xl:col-span-2"><QueueCard items={d.queue.items} total={d.queue.total} accent="var(--color-sonarr)" /></div>
              <Card className="h-full">
                <CardHeader icon={CalendarDays} accent="var(--color-sonarr)" title="Airing soon" subtitle="Next 14 days" />
                <CardBody className="max-h-[520px] overflow-y-auto"><UpcomingList items={d.upcoming} /></CardBody>
              </Card>
            </div>
            <AutoImportCard queue={d.queue.items} />
            <Card>
              <CardHeader icon={Layers} title="Recently added series" />
              <PosterStrip items={d.recent.map((r) => ({ ...r, caption: r.network ?? String(r.year ?? '') }))} />
            </Card>
            <DisksCard disks={d.disks} />
          </div>
        )}
      </QueryState>
    </>
  );
}

export function RadarrPage() {
  const q = useRadarr();
  return (
    <>
      <ServiceHeader id="radarr" />
      <QueryState query={q} skeleton={pageSkeleton}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Movies" value={d.stats.movies} icon={Film} accent="var(--color-radarr)" hint={`${d.stats.monitored} monitored`} />
              <StatTile label="Downloaded" value={d.stats.downloaded} icon={CheckCircle2} accent="var(--color-ok)" hint={d.stats.movies ? `${Math.round((d.stats.downloaded / d.stats.movies) * 100)}% of library` : undefined} />
              <StatTile label="Missing" value={d.stats.missing} icon={SearchX} accent="var(--color-bad)" hint={`${d.stats.unreleased} not yet released`} />
              <StatTile label="Size on disk" value={d.stats.sizeOnDisk} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <div className="xl:col-span-2"><QueueCard items={d.queue.items} total={d.queue.total} accent="var(--color-radarr)" /></div>
              <Card className="h-full">
                <CardHeader icon={CalendarDays} accent="var(--color-radarr)" title="Upcoming releases" subtitle="Next 30 days" />
                <CardBody className="max-h-[520px] overflow-y-auto"><UpcomingList items={d.upcoming} /></CardBody>
              </Card>
            </div>
            <div className="grid gap-5 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader icon={Layers} title="Recently added movies" />
                <PosterStrip items={d.recent.map((r) => ({ ...r, caption: r.hasFile ? `${r.year ?? ''} · On disk` : `${r.year ?? ''} · Missing` }))} />
              </Card>
              <Card>
                <CardHeader icon={ListChecks} title="Quality breakdown" subtitle="Downloaded movies by quality" />
                <CardBody>
                  {d.qualities.length ? (
                    <div style={{ height: Math.max(120, d.qualities.length * 30) }}>
                      <ResponsiveContainer>
                        <BarChart data={d.qualities} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}>
                          <CartesianGrid {...gridProps} horizontal={false} vertical />
                          <XAxis type="number" {...axisProps} allowDecimals={false} />
                          <YAxis type="category" dataKey="name" {...axisProps} width={96} tick={{ fill: 'var(--color-ink-3)', fontSize: 11 }} />
                          <Tooltip cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} content={<ChartTooltip formatValue={(v) => `${v} movies`} />} />
                          <Bar dataKey="count" name="Movies" radius={[0, 4, 4, 0]}>
                            {d.qualities.map((q) => <Cell key={q.name} fill="#d97706" />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <EmptyState icon={ListChecks} title="No files yet" />
                  )}
                </CardBody>
              </Card>
            </div>
            <DisksCard disks={d.disks} />
          </div>
        )}
      </QueryState>
    </>
  );
}

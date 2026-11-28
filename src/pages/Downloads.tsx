import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, CircleAlert, Download, Gauge, HardDrive, LoaderCircle, Pause, Play, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useClientItem, useClientLimits, useClientPause, useClients, useHasClients, type ClientItem, type ClientView, type ItemState, type ItemSummary } from '@/hooks/useClients';
import { bytes, duration, relative, speed } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { AreaGradient, axisProps, ChartTooltip, gridProps, Legend, timeLabel } from '@/components/ui/Chart';
import { Input } from '@/components/ui/Input';
import { Menu, type MenuItem } from '@/components/ui/Menu';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { useT } from '@/i18n';

const STATE: Record<ItemState, 'neutral' | 'brand' | 'ok' | 'warn' | 'bad'> = {
  downloading: 'brand',
  seeding: 'ok',
  completed: 'ok',
  paused: 'neutral',
  queued: 'neutral',
  checking: 'neutral',
  stalled: 'warn',
  error: 'bad',
};

const FILTERS = ['all', 'active', 'seeding', 'paused', 'error'] as const;
type Filter = (typeof FILTERS)[number];
const matches = (f: Filter, i: ClientItem) =>
  f === 'all' ||
  (f === 'active' && ['downloading', 'stalled', 'queued', 'checking'].includes(i.state)) ||
  (f === 'seeding' && (i.state === 'seeding' || i.state === 'completed')) ||
  (f === 'paused' && i.state === 'paused') ||
  (f === 'error' && i.state === 'error');

/* For servers too old to send `summary`. */
const summarise = (items: ClientItem[]): ItemSummary => ({
  total: items.length,
  downloading: items.filter((i) => i.state === 'downloading').length,
  active: items.filter((i) => matches('active', i)).length,
  seeding: items.filter((i) => matches('seeding', i)).length,
  paused: items.filter((i) => matches('paused', i)).length,
  error: items.filter((i) => matches('error', i)).length,
  remaining: items.filter((i) => i.state !== 'seeding' && i.state !== 'completed').reduce((n, i) => n + i.size - i.downloaded, 0),
});

function ItemRow({ c, i }: { c: ClientView; i: ClientItem }) {
  const { user } = useAuth();
  const act = useClientItem();
  const t = useT();
  const run = (action: 'pause' | 'resume' | 'remove' | 'remove-data') => act.mutate({ id: c.id, item: i.id, action, name: i.name });
  const items: MenuItem[] = [
    i.state === 'paused' ? { label: t('widgets.controls.resume'), icon: Play, onSelect: () => run('resume') } : { label: t('widgets.controls.pause'), icon: Pause, onSelect: () => run('pause') },
    { label: t('library.dl.remove'), icon: Trash2, hint: t('library.dl.removeHint'), onSelect: () => confirm(t('library.dl.confirmRemove', { name: i.name, client: c.name })) && run('remove') },
    { label: t('library.dl.removeData'), icon: Trash2, danger: true, onSelect: () => confirm(t('library.dl.confirmRemoveData', { name: i.name })) && run('remove-data') },
  ];
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium" title={i.name}>{i.name}</span>
          {i.category && <Pill className="shrink-0">{i.category}</Pill>}
        </div>
        <div className="truncate text-[11px] text-ink-4">
          {[
            t('ui.usedOf', { used: bytes(i.downloaded), total: bytes(i.size) }),
            i.downSpeed ? `↓ ${speed(i.downSpeed)}` : undefined,
            i.upSpeed ? `↑ ${speed(i.upSpeed)}` : undefined,
            i.eta && i.state === 'downloading' ? t('me.left', { time: duration(i.eta * 1000) }) : undefined,
            i.ratio !== undefined && c.protocol === 'torrent' ? t('library.dl.ratio', { ratio: i.ratio.toFixed(2) }) : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        <ProgressBar value={i.progress} height={3} glow={false} className="mt-1.5" color={i.state === 'error' ? 'var(--color-bad)' : i.state === 'stalled' ? 'var(--color-warn)' : undefined} />
        {i.error && <p className="mt-1 text-[11px] text-bad">{i.error}</p>}
      </div>
      <Pill tone={STATE[i.state]} className="shrink-0">{t(`library.dl.state.${i.state}`)}</Pill>
      {user?.isAdmin && (
        <div title={act.error ? (act.error as Error).message : undefined}>
          {act.isPending ? <LoaderCircle className="m-1.5 size-4 animate-spin text-ink-4" /> : <Menu items={items} label={t('ui.actionsFor', { title: i.name })} trigger={act.isError ? <CircleAlert className="size-4 text-bad" /> : undefined} />}
        </div>
      )}
    </li>
  );
}

function Limits({ c }: { c: ClientView }) {
  const set = useClientLimits();
  const t = useT();
  const kib = (n?: number) => (n ? String(Math.round(n / 1024)) : '');
  const [down, setDown] = useState(kib(c.downLimit));
  const [up, setUp] = useState(kib(c.upLimit));
  const toBytes = (v: string) => Math.max(0, Number(v) || 0) * 1024;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        set.mutate({ id: c.id, down: toBytes(down), up: toBytes(up) });
      }}
    >
      <Gauge className="size-4 text-ink-4" />
      <label className="flex items-center gap-1.5 text-xs text-ink-3">
        ↓ <Input className="h-8 w-24 text-xs" inputMode="numeric" placeholder={t('library.dl.unlimited')} value={down} onChange={(e) => setDown(e.target.value.replace(/\D/g, ''))} aria-label={t('library.dl.downLimit')} />
      </label>
      {c.protocol === 'torrent' && (
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          ↑ <Input className="h-8 w-24 text-xs" inputMode="numeric" placeholder={t('library.dl.unlimited')} value={up} onChange={(e) => setUp(e.target.value.replace(/\D/g, ''))} aria-label={t('library.dl.upLimit')} />
        </label>
      )}
      <span className="text-[11px] text-ink-4">KiB/s</span>
      <Button size="sm" type="submit" disabled={set.isPending}>{set.isPending && <LoaderCircle className="size-3.5 animate-spin" />} {t('library.dl.setLimits')}</Button>
      {set.error && <span className="text-xs text-bad">{(set.error as Error).message}</span>}
    </form>
  );
}

function ClientCard({ c }: { c: ClientView }) {
  const { user } = useAuth();
  const pause = useClientPause();
  const t = useT();
  const [filter, setFilter] = useState<Filter>('all');
  const items = (c.items ?? []).filter((i) => matches(filter, i)).sort((a, b) => b.downSpeed - a.downSpeed || a.progress - b.progress);
  const inFilter = c.summary ? (filter === 'all' ? c.summary.total : c.summary[filter]) : items.length;
  return (
    <Card>
      <CardHeader
        icon={Download}
        accent={c.online ? 'var(--color-downloads)' : 'var(--color-bad)'}
        title={c.name}
        subtitle={
          c.online
            ? [c.typeName, c.version && `v${c.version}`, `↓ ${speed(c.downSpeed)}`, c.protocol === 'torrent' ? `↑ ${speed(c.upSpeed)}` : undefined, c.freeSpace !== undefined ? t('library.dl.free', { size: bytes(c.freeSpace) }) : undefined]
                .filter(Boolean)
                .join(' · ')
            : `${c.typeName} · ${c.lastSuccess ? t('library.dl.offlineSince', { when: relative(c.lastSuccess) }) : t('library.dl.offline')}`
        }
        action={
          user?.isAdmin && c.online ? (
            <Button size="sm" disabled={pause.isPending} onClick={() => pause.mutate({ id: c.id, paused: !c.paused })}>
              {pause.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : c.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {c.paused ? t('library.dl.resumeAll') : t('library.dl.pauseAll')}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {!c.online ? (
          <p className="rounded-xl border border-bad/25 bg-bad/[0.06] px-4 py-3 text-sm text-bad">{c.error ?? t('widgets.services.checking')}</p>
        ) : (
          <>
            {user?.isAdmin && <div className="mb-3"><Limits key={`${c.downLimit}-${c.upLimit}`} c={c} /></div>}
            <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label={t('library.dl.filter')}>
              {FILTERS.filter((f) => c.protocol === 'torrent' || f !== 'seeding').map((f) => {
                const n = c.summary ? (f === 'all' ? c.summary.total : c.summary[f]) : (c.items ?? []).filter((i) => matches(f, i)).length;
                return (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn('rounded-lg border px-2.5 py-1 text-xs capitalize transition', filter === f ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
                  >
                    {t(`library.dl.filters.${f}`)} <span className="tabular text-ink-4">{n}</span>
                  </button>
                );
              })}
            </div>
            {!items.length ? (
              <EmptyState icon={Download} title={t('library.dl.nothing')} className="py-6" />
            ) : (
              <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">{items.map((i) => <ItemRow key={i.id} c={c} i={i} />)}</ul>
            )}
            {inFilter > items.length && <p className="mt-2 text-xs text-ink-4">{t('library.dl.showingSome', { shown: items.length, total: inFilter })}</p>}
            {pause.error && <p className="mt-2 text-xs text-bad">{(pause.error as Error).message}</p>}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export default function DownloadsPage() {
  const has = useHasClients();
  const q = useClients();
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t('library.dl.eyebrow')} title={t('settings.tabs.downloads.label')} description={t('library.dl.description')} />
      {!has ? (
        <Card><EmptyState icon={Download} title={t('library.dl.none')} description={t('library.dl.noneHint')} /></Card>
      ) : (
        <QueryState query={q} skeleton={<PageLoader label={t('library.dl.loading')} hint={t('library.dl.loadingHint')} />}>
          {(d) => {
            const online = d.clients.filter((c) => c.online);
            const down = online.reduce((n, c) => n + (c.downSpeed ?? 0), 0);
            const up = online.reduce((n, c) => n + (c.upSpeed ?? 0), 0);
            const totals = online.map((c) => c.summary ?? summarise(c.items ?? []));
            const total = (k: keyof ItemSummary) => totals.reduce((n, s) => n + s[k], 0);
            const left = total('remaining');
            return (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile label={t('widgets.requests.phase.downloading')} value={down} format={(n) => speed(n)} icon={ArrowDown} accent="var(--color-downloads)" />
                  <StatTile label={t('library.dl.uploading')} value={up} format={(n) => speed(n)} icon={ArrowUp} accent="var(--color-ok)" />
                  <StatTile label={t('library.dl.active')} value={total('downloading')} icon={Download} accent="var(--color-brand)" hint={t('library.dl.total', { count: total('total') })} />
                  <StatTile label={t('library.dl.remaining')} value={left} format={(n) => bytes(n)} icon={HardDrive} accent="var(--color-infinidisk)" hint={t('library.dl.offlineCount', { count: d.clients.length - online.length })} />
                </div>
                <Card>
                  <CardHeader icon={Gauge} accent="var(--color-downloads)" title={t('library.dl.throughput')} subtitle={t('library.dl.last15')} action={<Legend items={[{ label: t('library.dl.down'), color: 'var(--color-downloads)' }, { label: t('library.dl.up'), color: 'var(--color-ok)' }]} />} />
                  <CardBody>
                    <div className="h-40">
                      <ResponsiveContainer>
                        <AreaChart data={d.history} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <AreaGradient id="g-down" color="var(--color-downloads)" />
                            <AreaGradient id="g-up" color="var(--color-ok)" />
                          </defs>
                          <CartesianGrid {...gridProps} />
                          <XAxis dataKey="t" hide />
                          <YAxis {...axisProps} tickFormatter={(v: number) => speed(v)} width={70} />
                          <Tooltip content={<ChartTooltip formatValue={(v) => speed(v)} formatLabel={timeLabel} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                          <Area type="monotone" dataKey="down" name={t('library.dl.down')} stroke="var(--color-downloads)" strokeWidth={2} fill="url(#g-down)" isAnimationActive={false} />
                          <Area type="monotone" dataKey="up" name={t('library.dl.up')} stroke="var(--color-ok)" strokeWidth={2} fill="url(#g-up)" isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardBody>
                </Card>
                <div className="grid items-start gap-5 xl:grid-cols-2">{d.clients.map((c) => <ClientCard key={c.id} c={c} />)}</div>
              </div>
            );
          }}
        </QueryState>
      )}
    </>
  );
}

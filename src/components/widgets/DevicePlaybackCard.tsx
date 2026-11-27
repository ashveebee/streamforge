import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CircleAlert, FlaskConical, MonitorPlay } from 'lucide-react';
import { useDeviceReport, usePlayability, VERDICT, type Capability, type DeviceReport, type Verdict } from '@/hooks/usePlayability';
import { cn } from '@/lib/cn';
import { num, relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { t } from '@/i18n';

const ORDER: Verdict[] = ['direct', 'remux', 'audio', 'video'];
const BAR: Record<Verdict, string> = { direct: 'bg-ok', remux: 'bg-ink-4', audio: 'bg-warn', video: 'bg-bad' };

/**
 * Library health: for each device people watch on, how much of the library
 * plays directly and what forces the rest to convert. Admins only.
 */
export function DevicePlaybackCard() {
  const status = usePlayability();
  const devices = useMemo(() => status.data?.devices ?? [], [status.data]);
  const household = devices.filter((d) => d.household);
  const others = devices.filter((d) => !d.household);
  const [key, setKey] = useState<string>();
  useEffect(() => {
    if (!key && devices.length) setKey((household[0] ?? devices[0])!.key);
  }, [key, devices, household]);
  const report = useDeviceReport(key);

  return (
    <Card>
      <CardHeader
        icon={MonitorPlay}
        accent="var(--color-jellyfin)"
        title={t('widgets.devices.title')}
        subtitle={t('widgets.devices.subtitle')}
      />
      {status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data ? (
        <SkeletonRows className="p-5" />
      ) : !devices.length ? (
        <EmptyState
          icon={MonitorPlay}
          title={status.data.ready ? t('widgets.devices.learning') : t('widgets.devices.needsKey')}
          description={
            status.data.ready
              ? t('widgets.devices.learningHint')
              : t('widgets.devices.needsKeyHint')
          }
        />
      ) : (
        <CardBody>
          <label className="mb-4 flex flex-col gap-1 text-xs text-ink-3 sm:flex-row sm:items-center sm:gap-3">
            {t('widgets.devices.device')}
            <Select className="h-9 sm:max-w-xs" value={key ?? ''} onChange={(e) => setKey(e.target.value)}>
              {household.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.device}
                  {d.client ? ` · ${d.client}` : ''}
                </option>
              ))}
              {others.length > 0 && (
                <optgroup label={t('widgets.devices.rare')}>
                  {others.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.device}
                      {d.client ? ` · ${d.client}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </label>
          {report.isError ? (
            <ErrorState error={report.error} onRetry={() => void report.refetch()} />
          ) : !report.data ? (
            <SkeletonRows rows={5} />
          ) : (
            <Report r={report.data} />
          )}
        </CardBody>
      )}
    </Card>
  );
}

function Report({ r }: { r: DeviceReport }) {
  const [all, setAll] = useState(false);
  const titles = all ? r.titles : r.titles.slice(0, 12);
  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-3">
          <span>
            {t('widgets.devices.files', { files: num(r.files) })} · {t('widgets.devices.learned', { count: r.device.plays })}
          </span>
          <span>{t('widgets.devices.read', { when: relative(r.scannedAt) })}</span>
        </div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.04]" role="img" aria-label={ORDER.map((v) => `${VERDICT[v].label}: ${r.counts[v]}`).join(', ')}>
          {ORDER.map((v) => (r.counts[v] ? <span key={v} className={BAR[v]} style={{ width: `${(r.counts[v] / Math.max(1, r.files)) * 100}%` }} /> : null))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ORDER.map((v) => (
            <div key={v} title={VERDICT[v].hint}>
              <div className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                <span className={cn('size-2 rounded-full', BAR[v])} />
                {VERDICT[v].label}
              </div>
              <div className="text-[15px] font-semibold text-ink tabular">
                {num(r.counts[v])}
                <span className="ml-1 text-[11px] font-normal text-ink-4">{Math.round((r.counts[v] / Math.max(1, r.files)) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-2">{t('widgets.devices.causes')}</h3>
          {r.causes.length ? (
            <ul className="space-y-1.5">
              {r.causes.map((c) => (
                <li key={c.text} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-ink">{c.text}</span>
                  <span className="shrink-0 text-xs text-ink-4 tabular">{t('widgets.devices.files', { files: num(c.files) })}</span>
                  <Pill tone={VERDICT[c.verdict].tone} className="shrink-0">{VERDICT[c.verdict].label}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">{t('widgets.devices.noCauses')}</p>
          )}
          {r.untested.length > 0 && (
            <p className="mt-3 flex gap-1.5 text-[12px] text-ink-3">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
              <span>
                {t('widgets.devices.untested', { list: r.untested.map((u) => `${u.text} (${num(u.files)})`).join(', ') })}
              </span>
            </p>
          )}
          {r.bitrateLimited > 0 && (
            <p className="mt-2 flex gap-1.5 text-[12px] text-ink-3">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
              <span>
                {t('widgets.devices.bitrate', { count: r.bitrateLimited })}
              </span>
            </p>
          )}
        </div>
        <Capabilities caps={r.capabilities} />
      </div>

      {r.titles.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-2">{t('widgets.devices.titles')}</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {titles.map((x) => {
              const bad = x.files - x.counts.direct;
              return (
                <li key={x.id}>
                  <Link to={`/media/jellyfin/${x.id}`} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-white/[0.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">
                        {x.title}
                        {x.year ? <span className="text-ink-4"> ({x.year})</span> : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        {x.kind === 'series' ? `${t('widgets.devices.episodesOf', { bad, count: x.files })} · ` : ''}
                        {x.problems.join(', ')}
                      </span>
                    </span>
                    <Pill tone={VERDICT[x.worst].tone} className="shrink-0">{VERDICT[x.worst].label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
          {(r.titles.length > 12 || r.moreTitles > 0) && (
            <div className="mt-2 flex items-center gap-3">
              {r.titles.length > 12 && (
                <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
                  {all ? t('widgets.devices.fewer') : t('widgets.devices.all', { count: r.titles.length })}
                </Button>
              )}
              {all && r.moreTitles > 0 && <span className="text-xs text-ink-4">{t('widgets.devices.more', { count: r.moreTitles })}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}



function Capabilities({ caps }: { caps: Capability[] }) {
  const groups = new Map<Capability['kind'], Capability[]>();
  for (const c of caps) groups.set(c.kind, [...(groups.get(c.kind) ?? []), c]);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink-2">{t('widgets.devices.played')}</h3>
      <dl className="space-y-1.5">
        {[...groups].map(([kind, list]) => (
          <div key={kind} className="grid grid-cols-[84px_1fr] items-start gap-2">
            <dt className="pt-0.5 text-[11.5px] text-ink-4">{t(`widgets.devices.kind.${kind}`)}</dt>
            <dd className="flex flex-wrap gap-1">
              {list.map((c) => (
                <span
                  key={c.value}
                  title={`${c.status === 'yes' ? t('widgets.devices.plays') : t('widgets.devices.converts')} · ${t('widgets.devices.seen', { count: c.ok + c.bad, when: relative(c.lastAt) })}`}
                  className={cn(
                    'rounded-md border px-1.5 py-px text-[11px]',
                    c.status === 'yes' ? 'border-ok/25 bg-ok/10 text-ok' : 'border-bad/25 bg-bad/10 text-bad line-through decoration-bad/60',
                  )}
                >
                  {c.label}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-ink-4">{t('widgets.devices.legend')}</p>
    </div>
  );
}

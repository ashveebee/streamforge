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
        title="How your library plays on each device"
        subtitle="Learned from real plays: what each device handles, and what makes Jellyfin convert"
      />
      {status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data ? (
        <SkeletonRows className="p-5" />
      ) : !devices.length ? (
        <EmptyState
          icon={MonitorPlay}
          title={status.data.ready ? 'Learning your devices' : 'Needs a Jellyfin API key'}
          description={
            status.data.ready
              ? 'Every play teaches StreamForge what that device can handle. Profiles appear here after a few plays.'
              : 'Add a Jellyfin API key in Settings so StreamForge can watch plays and read your whole library.'
          }
        />
      ) : (
        <CardBody>
          <label className="mb-4 flex flex-col gap-1 text-xs text-ink-3 sm:flex-row sm:items-center sm:gap-3">
            Device
            <Select className="h-9 sm:max-w-xs" value={key ?? ''} onChange={(e) => setKey(e.target.value)}>
              {household.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.device}
                  {d.client ? ` · ${d.client}` : ''}
                </option>
              ))}
              {others.length > 0 && (
                <optgroup label="Seen only once or twice, or not lately">
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
            {num(r.files)} files in Jellyfin · learned from {r.device.plays} play{r.device.plays === 1 ? '' : 's'} on this device
          </span>
          <span>Library read {relative(r.scannedAt)}</span>
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
          <h3 className="mb-2 text-xs font-medium text-ink-2">What makes it convert</h3>
          {r.causes.length ? (
            <ul className="space-y-1.5">
              {r.causes.map((c) => (
                <li key={c.text} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate text-ink">{c.text}</span>
                  <span className="shrink-0 text-xs text-ink-4 tabular">{num(c.files)} files</span>
                  <Pill tone={VERDICT[c.verdict].tone} className="shrink-0">{VERDICT[c.verdict].label}</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">Nothing it has been tried with. Everything in the library should play directly.</p>
          )}
          {r.untested.length > 0 && (
            <p className="mt-3 flex gap-1.5 text-[12px] text-ink-3">
              <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
              <span>
                Not tried on this device yet: {r.untested.map((u) => `${u.text} (${num(u.files)})`).join(', ')}. These count as playing directly until a play shows otherwise.
              </span>
            </p>
          )}
          {r.bitrateLimited > 0 && (
            <p className="mt-2 flex gap-1.5 text-[12px] text-ink-3">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
              <span>
                {r.bitrateLimited} play{r.bitrateLimited === 1 ? ' was' : 's were'} converted for a bitrate limit. That’s a user or network setting in Jellyfin, not something the device lacks.
              </span>
            </p>
          )}
        </div>
        <Capabilities caps={r.capabilities} />
      </div>

      {r.titles.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-ink-2">Titles that won’t play directly</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {titles.map((t) => {
              const bad = t.files - t.counts.direct;
              return (
                <li key={t.id}>
                  <Link to={`/media/jellyfin/${t.id}`} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-white/[0.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">
                        {t.title}
                        {t.year ? <span className="text-ink-4"> ({t.year})</span> : null}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-3">
                        {t.kind === 'series' ? `${bad} of ${t.files} episodes · ` : ''}
                        {t.problems.join(', ')}
                      </span>
                    </span>
                    <Pill tone={VERDICT[t.worst].tone} className="shrink-0">{VERDICT[t.worst].label}</Pill>
                  </Link>
                </li>
              );
            })}
          </ul>
          {(r.titles.length > 12 || r.moreTitles > 0) && (
            <div className="mt-2 flex items-center gap-3">
              {r.titles.length > 12 && (
                <Button variant="ghost" size="sm" onClick={() => setAll((x) => !x)}>
                  {all ? 'Show fewer' : `Show all ${r.titles.length}`}
                </Button>
              )}
              {all && r.moreTitles > 0 && <span className="text-xs text-ink-4">and {r.moreTitles} more</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: Record<Capability['kind'], string> = {
  container: 'File types',
  vcodec: 'Video',
  range: 'HDR',
  bitdepth: 'Bit depth',
  res: 'Resolution',
  acodec: 'Audio',
  channels: 'Channels',
  sub: 'Subtitles',
};

function Capabilities({ caps }: { caps: Capability[] }) {
  const groups = new Map<Capability['kind'], Capability[]>();
  for (const c of caps) groups.set(c.kind, [...(groups.get(c.kind) ?? []), c]);
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-ink-2">What it has played</h3>
      <dl className="space-y-1.5">
        {[...groups].map(([kind, list]) => (
          <div key={kind} className="grid grid-cols-[84px_1fr] items-start gap-2">
            <dt className="pt-0.5 text-[11.5px] text-ink-4">{KIND_LABEL[kind]}</dt>
            <dd className="flex flex-wrap gap-1">
              {list.map((c) => (
                <span
                  key={c.value}
                  title={`${c.status === 'yes' ? 'Plays' : 'Converts'} · seen ${c.ok + c.bad} time${c.ok + c.bad === 1 ? '' : 's'}, last ${relative(c.lastAt)}`}
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
      <p className="mt-2 text-[11px] text-ink-4">Green played directly. Crossed out made Jellyfin convert.</p>
    </div>
  );
}

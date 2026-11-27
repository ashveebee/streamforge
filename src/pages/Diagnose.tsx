import { Link } from 'react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CircleAlert, Clock, Globe, House, Lightbulb, Radar, Search, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useDiagnosis, useExplain, useSetUploadSpeed, type Analysis, type DiagnosisStatus, type Finding, type Incident, type PlayMethod, type Question } from '@/hooks/useDiagnosis';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { axisProps, ChartTooltip, gridProps, Legend, timeLabel } from '@/components/ui/Chart';
import { Input, Select } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/States';
import { getLocale } from '@/i18n';
import { dayLabel } from '@/lib/format';

const COLORS = {
  upload: '#0d9488',
  stream: '#8b5cf6',
  seeding: '#d97706',
  down: '#0284c7',
  cpu: '#8b5cf6',
  speed: '#0d9488',
  stall: 'rgb(244 63 94 / 0.14)',
};

const METHOD: Record<PlayMethod, string> = { DirectPlay: 'Direct play', DirectStream: 'Direct stream', Transcode: 'Converting' };
const mbps = (bps: number | undefined) => (bps === undefined ? '—' : bps >= 10e6 ? `${Math.round(bps / 1e6)} Mbps` : `${(bps / 1e6).toFixed(1)} Mbps`);
const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const day = d.toDateString() === today.toDateString() || d.toDateString() === yesterday.toDateString() ? dayLabel(d.toISOString()) : d.toLocaleDateString(getLocale(), { weekday: 'short' });
  return `${day} ${d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' })}`;
};
const lost = (ms: number) => (ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

function confidence(c: number | null): { label: string; tone: 'bad' | 'warn' | 'neutral' } {
  if (c === null) return { label: 'Best guess', tone: 'neutral' };
  if (c >= 0.8) return { label: 'Very likely', tone: 'bad' };
  if (c >= 0.6) return { label: 'Likely', tone: 'warn' };
  return { label: 'Possible', tone: 'neutral' };
}

/** `datetime-local` value for a timestamp, in local time. */
const localInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export default function DiagnosePage() {
  const { user } = useAuth();
  const status = useDiagnosis();
  const [question, setQuestion] = useState<Question>();

  // Open the most recent stall by default.
  const first = status.data?.incidents[0]?.id;
  useEffect(() => {
    if (!question && first) setQuestion({ incident: first });
  }, [first, question]);

  if (!user?.isAdmin) {
    return <Card><EmptyState icon={ShieldAlert} title="Administrators only" description="Only administrators can diagnose streams." /></Card>;
  }
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <PageLoader label="Loading the diagnosis" />;
  const s = status.data;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/now-playing" className="transition hover:text-ink">← Now Playing</Link>}
        title="Why did it buffer?"
        description="StreamForge spots streams that stopped moving forward and works out what on the server was getting in the way."
      />
      {!s.recording && (
        <Card className="mb-4">
          <div className="flex items-start gap-3 px-5 py-4 text-sm text-ink-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <span>{s.reason}</span>
          </div>
        </Card>
      )}
      {/* On phones the explanation follows the list of stalls; on wide screens it sits beside the left column. */}
      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_1fr]">
        <div className="lg:col-start-1 lg:row-start-1">
          <IncidentList status={s} selected={question && 'incident' in question ? question.incident : undefined} onPick={(id) => setQuestion({ incident: id })} />
        </div>
        <div className="min-w-0 lg:col-start-2 lg:row-span-4 lg:row-start-1">
          {question ? (
            <Explanation question={question} />
          ) : (
            <Card>
              <EmptyState
                icon={Radar}
                title={s.since ? 'No buffering spotted' : 'Nothing recorded yet'}
                description={
                  s.since
                    ? `No stream has stalled since ${when(s.since)}. If someone says theirs did, check that moment below.`
                    : 'StreamForge records a sample every 15 seconds. Stalls show up here once streams have played.'
                }
              />
            </Card>
          )}
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <AskMoment status={s} onAsk={setQuestion} />
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <UploadSetting status={s} />
        </div>
      </div>
    </>
  );
}

function IncidentList({ status, selected, onPick }: { status: DiagnosisStatus; selected?: string; onPick: (id: string) => void }) {
  return (
    <Card>
      <CardHeader
        icon={Radar}
        title="Stalls spotted"
        subtitle={status.since ? `Last ${status.keepDays} days · since ${when(status.since)}` : `Kept for ${status.keepDays} days`}
      />
      {!status.incidents.length ? (
        <CardBody className="text-sm text-ink-3">None yet.</CardBody>
      ) : (
        <ul className="max-h-[420px] divide-y divide-line overflow-y-auto border-t border-line">
          {status.incidents.map((i) => (
            <li key={i.id}>
              <IncidentRow i={i} active={i.id === selected} onClick={() => onPick(i.id)} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function IncidentRow({ i, active, onClick }: { i: Incident; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active || undefined}
      className={cn('flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-white/[0.03]', active && 'bg-white/[0.05]')}
    >
      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', active ? 'bg-brand' : 'bg-bad/70')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{i.title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-3">
          {i.user}
          {i.device ? ` · ${i.device}` : ''}
        </span>
      </span>
      <span className="shrink-0 text-right text-[11px] leading-tight text-ink-4">
        <span className="block">{when(i.start)}</span>
        <span className="block">{lost(i.lostMs)} lost</span>
      </span>
    </button>
  );
}

function AskMoment({ status, onAsk }: { status: DiagnosisStatus; onAsk: (q: Question) => void }) {
  const [session, setSession] = useState('');
  const [at, setAt] = useState(() => localInput(Date.now() - 10 * 60_000));
  const plays = status.plays;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = new Date(at).getTime();
    if (Number.isFinite(t)) onAsk({ at: t, session: session ? session.split('|')[0] : undefined });
  };
  return (
    <Card>
      <CardHeader icon={Search} title="Check a moment" subtitle="When someone says “it buffered around…”" />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs text-ink-3">
            Stream
            <Select
              className="mt-1 h-9"
              value={session}
              onChange={(e) => {
                setSession(e.target.value);
                const p = plays.find((x) => `${x.id}|${x.first}` === e.target.value);
                if (p) setAt(localInput(Math.round((p.first + p.last) / 2)));
              }}
            >
              <option value="">The whole server</option>
              {plays.map((p) => (
                <option key={`${p.id}|${p.first}`} value={`${p.id}|${p.first}`}>
                  {p.user} · {p.title} ({when(p.first)})
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-xs text-ink-3">
            Around
            <Input type="datetime-local" className="mt-1 h-9" value={at} onChange={(e) => setAt(e.target.value)} required />
          </label>
          <Button type="submit" variant="subtle" size="sm" className="w-full">
            <Clock className="size-3.5" />
            Explain this moment
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function UploadSetting({ status }: { status: DiagnosisStatus }) {
  const save = useSetUploadSpeed();
  const [value, setValue] = useState(status.uploadMbps ? String(status.uploadMbps) : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    save.mutate(value.trim() && n > 0 ? n : null);
  };
  return (
    <Card>
      <CardHeader icon={Globe} title="Your internet upload speed" subtitle="Remote viewers get video through it" />
      <CardBody>
        <form onSubmit={submit} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Upload speed in Mbps</span>
            <Input inputMode="decimal" className="h-9 pr-14" placeholder="Estimate it" value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-4">Mbps</span>
          </label>
          <Button type="submit" size="sm" className="h-9" disabled={save.isPending}>
            Save
          </Button>
        </form>
        <p className="mt-2 text-[11.5px] text-ink-4">
          {save.isError ? (save.error as Error).message : 'Leave empty and StreamForge uses the most it has seen go out.'}
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------- explanation ------------------------------ */

function Explanation({ question }: { question: Question }) {
  const q = useExplain(question);
  if (q.isError) return <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <Card><SkeletonRows rows={6} className="p-5" /></Card>;
  const a = q.data;
  const [top, ...rest] = a.findings;
  return (
    <div className="space-y-4">
      <Card>
        <div className="px-5 pt-5">
          <div className="text-xs text-ink-3">
            {a.incident
              ? `${when(a.incident.start)} · stalled for about ${lost(a.incident.lostMs)}`
              : `Around ${when(a.focus.from + 60_000)} · no stall was spotted in this stream, so here is what the server was doing`}
          </div>
          {a.stream && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">{a.stream.title}</h2>
              <span className="text-sm text-ink-3">
                {a.stream.user}
                {a.stream.device ? ` · ${a.stream.device}` : ''}
              </span>
            </div>
          )}
          {a.stream && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill>{a.stream.remote ? <><Globe className="mr-1 inline size-3" />Away from home</> : <><House className="mr-1 inline size-3" />At home</>}</Pill>
              <Pill tone={a.stream.method === 'Transcode' ? 'warn' : 'neutral'}>{METHOD[a.stream.method]}</Pill>
              {(a.stream.res || a.stream.codec) && <Pill>{[a.stream.res, a.stream.codec?.toUpperCase()].filter(Boolean).join(' ')}</Pill>}
              {a.stream.bitrate && <Pill>{mbps(a.stream.bitrate)}</Pill>}
            </div>
          )}
        </div>
        {top && <Verdict f={top} />}
      </Card>

      {rest.length > 0 && (
        <Card>
          <CardHeader title="Also playing a part" subtitle="Less likely, but worth knowing" />
          <ul className="divide-y divide-line border-t border-line">
            {rest.map((f) => (
              <li key={f.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[13.5px] font-medium text-ink">{f.title}</div>
                  <Pill tone={confidence(f.confidence).tone} className="shrink-0">{confidence(f.confidence).label}</Pill>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-3">{f.detail}</p>
                <Evidence items={f.evidence} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Timeline a={a} />

      {a.others.length > 0 && (
        <Card>
          <CardHeader title="Also playing at the time" />
          <ul className="divide-y divide-line border-t border-line">
            {a.others.map((o, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  <span className="text-ink">{o.user}</span> · {o.title}
                </span>
                <span className="shrink-0 text-xs text-ink-4">
                  {METHOD[o.method]} · {o.remote ? 'away' : 'home'}
                  {o.bitrate ? ` · ${mbps(o.bitrate)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Verdict({ f }: { f: Finding }) {
  const c = confidence(f.confidence);
  return (
    <div className="mt-4 border-t border-line px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={c.tone}>{c.label}</Pill>
        <h3 className="text-[16px] font-semibold tracking-tight text-ink">{f.title}</h3>
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{f.detail}</p>
      <Evidence items={f.evidence} />
      {f.fixes.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2">
            <Lightbulb className="size-3.5 text-warn" />
            What to try
          </div>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] text-ink-2">
            {f.fixes.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Evidence({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-[12px] text-ink-3">
      {items.map((e) => (
        <li key={e} className="flex gap-2">
          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" />
          <span>{e}</span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------- timeline -------------------------------- */

function Timeline({ a }: { a: Analysis }) {
  const data = useMemo(
    () =>
      a.series.map((p) => ({
        t: p.t,
        upload: p.tx !== undefined ? p.tx / 1e6 : undefined,
        seeding: p.up !== undefined ? p.up / 1e6 : undefined,
        down: p.down !== undefined ? p.down / 1e6 : undefined,
        stream: p.bitrate !== undefined ? p.bitrate / 1e6 : undefined,
        cpu: p.cpu,
        speed: p.speed !== undefined ? Math.round(p.speed * 100) : undefined,
      })),
    [a.series],
  );
  const has = (k: keyof (typeof data)[number]) => data.some((d) => d[k] !== undefined);
  const stalls = a.stalls.length ? a.stalls : a.incident ? [{ start: a.incident.start, end: a.incident.end }] : [];
  const areas = stalls.map((s) => <ReferenceArea key={s.start} x1={s.start} x2={s.end} fill={COLORS.stall} strokeOpacity={0} ifOverflow="extendDomain" />);
  const fmtMbps = (v: number) => (Number.isFinite(v) ? `${v.toFixed(v >= 10 ? 0 : 1)} Mbps` : '—');
  const xProps = { ...axisProps, dataKey: 't', type: 'number' as const, domain: ['dataMin', 'dataMax'] as [string, string], scale: 'time' as const, tickFormatter: (t: number) => new Date(t).toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' }), minTickGap: 40 };
  const network = [
    has('upload') && { key: 'upload', label: 'Sent by the server', color: COLORS.upload },
    has('stream') && { key: 'stream', label: 'This stream', color: COLORS.stream },
    has('seeding') && { key: 'seeding', label: 'Seeding', color: COLORS.seeding },
    has('down') && { key: 'down', label: 'Downloading', color: COLORS.down },
  ].filter(Boolean) as { key: string; label: string; color: string }[];
  const server = [
    has('cpu') && { key: 'cpu', label: 'CPU', color: COLORS.cpu },
    has('speed') && { key: 'speed', label: 'Conversion speed', color: COLORS.speed },
  ].filter(Boolean) as { key: string; label: string; color: string }[];

  return (
    <Card>
      <CardHeader title="What was happening" subtitle="The shaded band is where the stream stalled" />
      <CardBody className="space-y-6">
        {network.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">Network</div>
              <Legend items={network} />
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  {areas}
                  <XAxis {...xProps} />
                  <YAxis {...axisProps} width={40} tickFormatter={(v: number) => `${v}`} />
                  {a.upload && <ReferenceLine y={a.upload.capacity / 1e6} stroke="rgb(255 255 255 / 0.3)" strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: a.upload.estimated ? 'Highest seen' : 'Your upload', fill: 'var(--color-ink-4)', fontSize: 10, position: 'insideTopRight' }} />}
                  <Tooltip content={<ChartTooltip formatLabel={timeLabel} formatValue={fmtMbps} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                  {network.map((n) => (
                    <Line key={n.key} type="monotone" dataKey={n.key} name={n.label} stroke={n.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        {server.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">Server</div>
              <Legend items={server} />
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  {areas}
                  <XAxis {...xProps} />
                  <YAxis {...axisProps} width={56} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 50) * 50)]} tickFormatter={(v: number) => `${v}%`} />
                  {has('speed') && <ReferenceLine y={100} stroke="rgb(255 255 255 / 0.3)" strokeDasharray="4 4" label={{ value: 'Real time', fill: 'var(--color-ink-4)', fontSize: 10, position: 'insideTopRight' }} />}
                  <Tooltip content={<ChartTooltip formatLabel={timeLabel} formatValue={(v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—')} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                  {server.map((n) => (
                    <Line key={n.key} type="monotone" dataKey={n.key} name={n.label} stroke={n.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {has('speed') && <p className="mt-2 text-[11.5px] text-ink-4">Conversion speed below 100% means Jellyfin made video slower than it was watched.</p>}
          </div>
        )}
        {!network.length && !server.length && (
          <p className="text-sm text-ink-3">No server measurements for this time. Turn on host metrics and connect your download clients for a timeline.</p>
        )}
      </CardBody>
    </Card>
  );
}

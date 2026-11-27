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
import { getLocale, t } from '@/i18n';
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

const METHOD = (m: PlayMethod) => t(m === 'DirectPlay' ? 'ui.method.directPlay' : m === 'DirectStream' ? 'ui.method.directStream' : 'admin.diag.converting');
const mbps = (bps: number | undefined) => (bps === undefined ? '—' : bps >= 10e6 ? `${Math.round(bps / 1e6)} Mbps` : `${(bps / 1e6).toFixed(1)} Mbps`);
const when = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const day = d.toDateString() === today.toDateString() || d.toDateString() === yesterday.toDateString() ? dayLabel(d.toISOString()) : d.toLocaleDateString(getLocale(), { weekday: 'short' });
  return `${day} ${d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' })}`;
};
const lost = (ms: number) => (ms >= 90_000 ? t('media.min', { n: Math.round(ms / 60_000) }) : `${Math.round(ms / 1000)} s`);

function confidence(c: number | null): { label: string; tone: 'bad' | 'warn' | 'neutral' } {
  if (c === null) return { label: t('admin.diag.bestGuess'), tone: 'neutral' };
  if (c >= 0.8) return { label: t('admin.diag.veryLikely'), tone: 'bad' };
  if (c >= 0.6) return { label: t('admin.diag.likely'), tone: 'warn' };
  return { label: t('admin.diag.possible'), tone: 'neutral' };
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
    return <Card><EmptyState icon={ShieldAlert} title={t('settings.adminsOnly')} description={t('admin.diag.adminsOnly')} /></Card>;
  }
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <PageLoader label={t('admin.diag.loading')} />;
  const s = status.data;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/now-playing" className="transition hover:text-ink">← {t('nav.nowPlaying')}</Link>}
        title={t('palette.pages.whyBuffer')}
        description={t('admin.diag.description')}
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
                title={s.since ? t('admin.diag.noneSpotted') : t('admin.diag.nothing')}
                description={s.since ? t('admin.diag.noneSince', { when: when(s.since) }) : t('admin.diag.nothingHint')}
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
        title={t('admin.diag.stalls')}
        subtitle={status.since ? t('admin.diag.lastDays', { n: status.keepDays, when: when(status.since) }) : t('admin.diag.kept', { n: status.keepDays })}
      />
      {!status.incidents.length ? (
        <CardBody className="text-sm text-ink-3">{t('admin.diag.noneYet')}</CardBody>
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
        <span className="block">{t('admin.diag.lost', { time: lost(i.lostMs) })}</span>
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
      <CardHeader icon={Search} title={t('admin.diag.check')} subtitle={t('admin.diag.checkHint')} />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs text-ink-3">
            {t('widgets.playing.stream')}
            <Select
              className="mt-1 h-9"
              value={session}
              onChange={(e) => {
                setSession(e.target.value);
                const p = plays.find((x) => `${x.id}|${x.first}` === e.target.value);
                if (p) setAt(localInput(Math.round((p.first + p.last) / 2)));
              }}
            >
              <option value="">{t('admin.diag.wholeServer')}</option>
              {plays.map((p) => (
                <option key={`${p.id}|${p.first}`} value={`${p.id}|${p.first}`}>
                  {p.user} · {p.title} ({when(p.first)})
                </option>
              ))}
            </Select>
          </label>
          <label className="block text-xs text-ink-3">
            {t('admin.diag.around')}
            <Input type="datetime-local" className="mt-1 h-9" value={at} onChange={(e) => setAt(e.target.value)} required />
          </label>
          <Button type="submit" variant="subtle" size="sm" className="w-full">
            <Clock className="size-3.5" />
            {t('admin.diag.explain')}
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
      <CardHeader icon={Globe} title={t('admin.diag.upload')} subtitle={t('admin.diag.uploadHint')} />
      <CardBody>
        <form onSubmit={submit} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">{t('admin.diag.uploadLabel')}</span>
            <Input inputMode="decimal" className="h-9 pr-14" placeholder={t('admin.diag.estimate')} value={value} onChange={(e) => setValue(e.target.value)} />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-ink-4">Mbps</span>
          </label>
          <Button type="submit" size="sm" className="h-9" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
        <p className="mt-2 text-[11.5px] text-ink-4">
          {save.isError ? (save.error as Error).message : t('admin.diag.leaveEmpty')}
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
              ? `${when(a.incident.start)} · ${t('admin.diag.stalledFor', { time: lost(a.incident.lostMs) })}`
              : t('admin.diag.aroundNoStall', { when: when(a.focus.from + 60_000) })}
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
              <Pill>{a.stream.remote ? <><Globe className="mr-1 inline size-3" />{t('admin.diag.away')}</> : <><House className="mr-1 inline size-3" />{t('admin.diag.home')}</>}</Pill>
              <Pill tone={a.stream.method === 'Transcode' ? 'warn' : 'neutral'}>{METHOD(a.stream.method)}</Pill>
              {(a.stream.res || a.stream.codec) && <Pill>{[a.stream.res, a.stream.codec?.toUpperCase()].filter(Boolean).join(' ')}</Pill>}
              {a.stream.bitrate && <Pill>{mbps(a.stream.bitrate)}</Pill>}
            </div>
          )}
        </div>
        {top && <Verdict f={top} />}
      </Card>

      {rest.length > 0 && (
        <Card>
          <CardHeader title={t('admin.diag.alsoPart')} subtitle={t('admin.diag.alsoPartHint')} />
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
          <CardHeader title={t('admin.diag.alsoPlaying')} />
          <ul className="divide-y divide-line border-t border-line">
            {a.others.map((o, i) => (
              <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate text-ink-2">
                  <span className="text-ink">{o.user}</span> · {o.title}
                </span>
                <span className="shrink-0 text-xs text-ink-4">
                  {METHOD(o.method)} · {o.remote ? t('admin.diag.awayShort') : t('admin.diag.homeShort')}
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
            {t('admin.diag.try')}
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
    has('upload') && { key: 'upload', label: t('admin.diag.sent'), color: COLORS.upload },
    has('stream') && { key: 'stream', label: t('admin.diag.thisStream'), color: COLORS.stream },
    has('seeding') && { key: 'seeding', label: t('library.dl.state.seeding'), color: COLORS.seeding },
    has('down') && { key: 'down', label: t('widgets.requests.phase.downloading'), color: COLORS.down },
  ].filter(Boolean) as { key: string; label: string; color: string }[];
  const server = [
    has('cpu') && { key: 'cpu', label: 'CPU', color: COLORS.cpu },
    has('speed') && { key: 'speed', label: t('admin.diag.speed'), color: COLORS.speed },
  ].filter(Boolean) as { key: string; label: string; color: string }[];

  return (
    <Card>
      <CardHeader title={t('admin.diag.happening')} subtitle={t('admin.diag.happeningHint')} />
      <CardBody className="space-y-6">
        {network.length > 0 && (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium text-ink-2">{t('admin.diag.network')}</div>
              <Legend items={network} />
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  {areas}
                  <XAxis {...xProps} />
                  <YAxis {...axisProps} width={40} tickFormatter={(v: number) => `${v}`} />
                  {a.upload && <ReferenceLine y={a.upload.capacity / 1e6} stroke="rgb(255 255 255 / 0.3)" strokeDasharray="4 4" ifOverflow="extendDomain" label={{ value: a.upload.estimated ? t('admin.diag.highest') : t('admin.diag.yourUpload'), fill: 'var(--color-ink-4)', fontSize: 10, position: 'insideTopRight' }} />}
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
              <div className="text-xs font-medium text-ink-2">{t('svc.server.server')}</div>
              <Legend items={server} />
            </div>
            <div className="h-44">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  {areas}
                  <XAxis {...xProps} />
                  <YAxis {...axisProps} width={56} domain={[0, (max: number) => Math.max(100, Math.ceil(max / 50) * 50)]} tickFormatter={(v: number) => `${v}%`} />
                  {has('speed') && <ReferenceLine y={100} stroke="rgb(255 255 255 / 0.3)" strokeDasharray="4 4" label={{ value: t('admin.diag.realTime'), fill: 'var(--color-ink-4)', fontSize: 10, position: 'insideTopRight' }} />}
                  <Tooltip content={<ChartTooltip formatLabel={timeLabel} formatValue={(v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—')} />} cursor={{ stroke: 'rgb(255 255 255 / 0.15)' }} />
                  {server.map((n) => (
                    <Line key={n.key} type="monotone" dataKey={n.key} name={n.label} stroke={n.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {has('speed') && <p className="mt-2 text-[11.5px] text-ink-4">{t('admin.diag.speedHint')}</p>}
          </div>
        )}
        {!network.length && !server.length && (
          <p className="text-sm text-ink-3">{t('admin.diag.noMeasure')}</p>
        )}
      </CardBody>
    </Card>
  );
}

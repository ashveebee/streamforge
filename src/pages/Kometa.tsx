import { useState } from 'react';
import { Link } from 'react-router';
import { Images, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { KOMETA_COLOR, SERVER_NAME, SOURCE_LABEL, useCollections, type CollectionSummary } from '@/hooks/useKometa';
import { jfImage } from '@/lib/api';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { PageLoader } from '@/components/ui/Loader';
import { Pill } from '@/components/ui/Status';
import { EmptyState, QueryState } from '@/components/ui/States';
import { CollectionForm, ServerTag } from '@/components/kometa/CollectionForm';
import { useKometaStatus } from '@/components/widgets/KometaCard';
import { getLocale, t } from '@/i18n';

export function KometaIcon({ size = 52 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-2xl border border-white/10"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, color-mix(in oklab, ${KOMETA_COLOR} 28%, #0d0f16), color-mix(in oklab, ${KOMETA_COLOR} 8%, #0d0f16))`,
        boxShadow: `0 8px 24px -12px ${KOMETA_COLOR}`,
      }}
    >
      <Images style={{ width: size * 0.46, height: size * 0.46, color: KOMETA_COLOR }} />
    </span>
  );
}

const STATUS = {
  built: { get label() { return t('kometa.status.built'); }, tone: 'ok' },
  waiting: { get label() { return t('kometa.status.waiting'); }, tone: 'neutral' },
  scheduled: { get label() { return t('kometa.status.scheduled'); }, tone: 'neutral' },
  error: { get label() { return t('widgets.queue.error'); }, tone: 'warn' },
} as const;

/** A collection's gradient stand-in when it has no poster yet. */
const swatch = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(160deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 80% 55%))`;
};

function CollectionCard({ c }: { c: CollectionSummary }) {
  const st = STATUS[c.status];
  return (
    <Link to={`/kometa/${encodeURIComponent(c.id)}`} className="card group flex gap-4 p-4 transition hover:-translate-y-0.5 hover:border-line-strong">
      <div className="relative aspect-[2/3] w-[74px] shrink-0 overflow-hidden rounded-lg shadow-lg" style={{ background: swatch(c.name) }}>
        {c.poster && <FadeImage src={jfImage(c.poster, 200)} alt="" className="absolute inset-0" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold">{c.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-3">
          <span>{c.source ? SOURCE_LABEL[c.source.type] : t('kometa.onServer')}</span>·<span>{c.library.name}</span>·<ServerTag type={c.library.serverType} />
        </div>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-ink-4">{t('kometa.items')}</dt>
          <dd className="text-ink-2">{c.count !== undefined ? c.count : c.status === 'waiting' ? t('kometa.waitingRun') : '—'}</dd>
          {c.status === 'error' ? (
            <>
              <dt className="text-ink-4">{t('widgets.queue.error')}</dt>
              <dd className="truncate text-warn" title={c.error}>{c.error}</dd>
            </>
          ) : c.builtAt ? (
            <>
              <dt className="text-ink-4">{t('kometa.changed')}</dt>
              <dd className="text-ink-2">{relative(new Date(c.builtAt).toISOString())}</dd>
            </>
          ) : c.updatedAt ? (
            <>
              <dt className="text-ink-4">{t('media.addedLabel')}</dt>
              <dd className="text-ink-2">{c.createdBy ? t('kometa.addedBy', { when: relative(c.updatedAt), who: c.createdBy }) : relative(c.updatedAt)}</dd>
            </>
          ) : null}
          {c.schedule && c.schedule !== 'always' && (
            <>
              <dt className="text-ink-4">{t('kometa.shown')}</dt>
              <dd className="text-ink-2">{c.schedule.from} – {c.schedule.to}</dd>
            </>
          )}
        </dl>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Pill tone={st.tone}>{st.label}</Pill>
          {c.managed ? <Pill tone="brand">StreamForge</Pill> : <span className="text-[11px] text-ink-4">{t('kometa.external')}</span>}
        </div>
      </div>
    </Link>
  );
}

export default function KometaPage() {
  const q = useCollections();
  const status = useKometaStatus();
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<string>('all');
  const d = q.data;
  const last = status.data?.lastRun;
  const waiting = d?.collections.filter((c) => c.managed && c.waitingForRun).length ?? 0;
  const servers = [...new Map((d?.collections ?? []).map((c) => [c.library.server, c.library])).values()];
  const shown = (d?.collections ?? []).filter((c) => (tab === 'all' ? true : tab === 'mine' ? c.managed : c.library.server === tab));
  const ready = !!d?.settings.folder.ok && d.libraries.length > 0;

  return (
    <>
      <PageHeader
        icon={<KometaIcon />}
        eyebrow={t('kometa.eyebrow')}
        title="Kometa"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {status.data?.running ? <Pill tone="brand">{t('widgets.kometa.running')}</Pill> : last ? <Pill tone={last.errors ? 'warn' : 'ok'}>{last.errors ? t('kometa.lastErrors', { count: last.errors }) : t('ui.status.healthy')}</Pill> : null}
            {last && <span>{t('widgets.kometa.finished', { when: relative(last.at) })}{last.runTime ? ` · ${t('widgets.kometa.took', { time: last.runTime })}` : ''}</span>}
            {d?.nextRun && <span>{t('kometa.nextRun', { when: new Date(d.nextRun).toLocaleString(getLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}</span>}
          </span>
        }
        actions={
          user?.isAdmin && ready ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> {t('kometa.new')}
            </Button>
          ) : undefined
        }
      />
      <QueryState query={q} skeleton={<PageLoader label={t('kometa.loading')} />}>
        {(data) => (
          <>
            {!data.settings.folder.ok && (
              <Card className="mb-5">
                <EmptyState
                  icon={SettingsIcon}
                  title={t('kometa.connect')}
                  description={`${data.settings.folder.message ?? ''} ${t('kometa.connectHint')}`.trim()}
                  action={
                    user?.isAdmin ? (
                      <Link to="/settings" className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-medium text-ink-2 hover:bg-white/[0.06]">
                        {t('kometa.openSettings')}
                      </Link>
                    ) : undefined
                  }
                />
              </Card>
            )}
            {waiting > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#f59e0b]/25 bg-[#f59e0b]/[0.06] px-4 py-3 text-[13px] text-ink-2">
                <b style={{ color: KOMETA_COLOR }}>{t('kometa.waiting', { count: waiting })}</b>
                {d?.nextRun
                  ? t('kometa.buildsOn', { count: waiting, when: new Date(d.nextRun).toLocaleString(getLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })
                  : t('kometa.builds', { count: waiting })}
              </div>
            )}
            <div role="tablist" aria-label={t('kometa.filter')} className="mb-5 flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: `${t('widgets.tasks.all')} · ${data.collections.length}` },
                ...servers.map((s) => ({ id: s.server, label: `${SERVER_NAME[s.serverType]} · ${s.serverName} · ${data.collections.filter((c) => c.library.server === s.server).length}`, type: s.serverType })),
                { id: 'mine', label: `${t('kometa.mine')} · ${data.collections.filter((c) => c.managed).length}` },
              ].map((x) => (
                <button
                  key={x.id}
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                  className={cn(
                    'h-8 rounded-xl border px-3 text-xs font-medium transition',
                    tab === x.id ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
                  )}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {shown.length ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((c) => <CollectionCard key={c.id} c={c} />)}
              </div>
            ) : (
              <Card>
                <EmptyState icon={Images} title={t('kometa.none')} description={ready ? t('kometa.noneHint') : undefined} />
              </Card>
            )}
            {adding && <CollectionForm libraries={data.libraries} nextRun={data.nextRun} onClose={() => setAdding(false)} />}
          </>
        )}
      </QueryState>
    </>
  );
}

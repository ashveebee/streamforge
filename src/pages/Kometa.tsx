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
  built: { label: 'Built', tone: 'ok' },
  waiting: { label: 'Waiting', tone: 'neutral' },
  scheduled: { label: 'Not in season', tone: 'neutral' },
  error: { label: 'Error', tone: 'warn' },
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
          <span>{c.source ? SOURCE_LABEL[c.source.type] : 'On the server'}</span>·<span>{c.library.name}</span>·<ServerTag type={c.library.serverType} />
        </div>
        <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-ink-4">Items</dt>
          <dd className="text-ink-2">{c.count !== undefined ? c.count : c.status === 'waiting' ? 'Waiting for the next run' : '—'}</dd>
          {c.status === 'error' ? (
            <>
              <dt className="text-ink-4">Error</dt>
              <dd className="truncate text-warn" title={c.error}>{c.error}</dd>
            </>
          ) : c.builtAt ? (
            <>
              <dt className="text-ink-4">Changed</dt>
              <dd className="text-ink-2">{relative(new Date(c.builtAt).toISOString())}</dd>
            </>
          ) : c.updatedAt ? (
            <>
              <dt className="text-ink-4">Added</dt>
              <dd className="text-ink-2">{relative(c.updatedAt)}{c.createdBy ? `, by ${c.createdBy}` : ''}</dd>
            </>
          ) : null}
          {c.schedule && c.schedule !== 'always' && (
            <>
              <dt className="text-ink-4">Shown</dt>
              <dd className="text-ink-2">{c.schedule.from} – {c.schedule.to}</dd>
            </>
          )}
        </dl>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Pill tone={st.tone}>{st.label}</Pill>
          {c.managed ? <Pill tone="brand">StreamForge</Pill> : <span className="text-[11px] text-ink-4">From your own Kometa files or the server</span>}
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
        eyebrow="Collections and overlays"
        title="Kometa"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {status.data?.running ? <Pill tone="brand">Running</Pill> : last ? <Pill tone={last.errors ? 'warn' : 'ok'}>{last.errors ? `${last.errors} error${last.errors === 1 ? '' : 's'} last run` : 'Healthy'}</Pill> : null}
            {last && <span>Last run finished {relative(last.at)}{last.runTime ? ` · took ${last.runTime}` : ''}</span>}
            {d?.nextRun && <span>Next run {new Date(d.nextRun).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
          </span>
        }
        actions={
          user?.isAdmin && ready ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> New collection
            </Button>
          ) : undefined
        }
      />
      <QueryState query={q} skeleton={<PageLoader label="Loading collections" />}>
        {(data) => (
          <>
            {!data.settings.folder.ok && (
              <Card className="mb-5">
                <EmptyState
                  icon={SettingsIcon}
                  title="Connect Kometa’s config folder"
                  description={`${data.settings.folder.message ?? ''} StreamForge writes its collections to its own file in that folder; Kometa builds them on its next run.`}
                  action={
                    user?.isAdmin ? (
                      <Link to="/settings" className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-strong px-3 text-sm font-medium text-ink-2 hover:bg-white/[0.06]">
                        Open Settings → Kometa
                      </Link>
                    ) : undefined
                  }
                />
              </Card>
            )}
            {waiting > 0 && (
              <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-[#f59e0b]/25 bg-[#f59e0b]/[0.06] px-4 py-3 text-[13px] text-ink-2">
                <b style={{ color: KOMETA_COLOR }}>{waiting} change{waiting === 1 ? '' : 's'} waiting.</b>
                Kometa builds {waiting === 1 ? 'it' : 'them'} on its next run{d?.nextRun ? `, ${new Date(d.nextRun).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.
              </div>
            )}
            <div role="tablist" aria-label="Filter collections" className="mb-5 flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: `All · ${data.collections.length}` },
                ...servers.map((s) => ({ id: s.server, label: `${SERVER_NAME[s.serverType]} · ${s.serverName} · ${data.collections.filter((c) => c.library.server === s.server).length}`, type: s.serverType })),
                { id: 'mine', label: `Made in StreamForge · ${data.collections.filter((c) => c.managed).length}` },
              ].map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'h-8 rounded-xl border px-3 text-xs font-medium transition',
                    tab === t.id ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {shown.length ? (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {shown.map((c) => <CollectionCard key={c.id} c={c} />)}
              </div>
            ) : (
              <Card>
                <EmptyState icon={Images} title="No collections here yet" description={ready ? 'Add one with New collection; Kometa builds it on its next run.' : undefined} />
              </Card>
            )}
            {adding && <CollectionForm libraries={data.libraries} nextRun={data.nextRun} onClose={() => setAdding(false)} />}
          </>
        )}
      </QueryState>
    </>
  );
}

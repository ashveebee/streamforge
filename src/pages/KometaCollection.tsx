import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Check, Code2, ExternalLink, History, LayoutGrid, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { KOMETA_COLOR, SOURCE_LABEL, useCollection, useCollections, useDeleteCollection, type CollectionDetail, type CollectionTitle } from '@/hooks/useKometa';
import { jfImage } from '@/lib/api';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { PageLoader } from '@/components/ui/Loader';
import { Pill } from '@/components/ui/Status';
import { QueryState } from '@/components/ui/States';
import { CollectionForm, ServerTag } from '@/components/kometa/CollectionForm';
import { AddToArrDialog } from '@/components/media/AddToArrDialog';

const STATUS = {
  built: { label: 'Built', tone: 'ok' },
  waiting: { label: 'Waiting for Kometa', tone: 'neutral' },
  scheduled: { label: 'Not in season', tone: 'neutral' },
  error: { label: 'Error', tone: 'warn' },
} as const;

const posterSrc = (p: CollectionTitle['poster'], w = 300) => (typeof p === 'string' ? p : jfImage(p, w));

function Stat({ value, label, tone }: { value: React.ReactNode; label: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] px-4 py-3">
      <div className="text-[22px] font-semibold tabular" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="text-[11.5px] text-ink-4">{label}</div>
    </div>
  );
}

function Titles({ d, admin }: { d: CollectionDetail; admin: boolean }) {
  const [tab, setTab] = useState<'all' | 'have' | 'missing'>('all');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const shown = d.titles.filter((t) => (tab === 'all' ? true : tab === 'have' ? t.inLibrary : !t.inLibrary));
  const pickable = d.titles.filter((t) => !t.inLibrary && t.tmdbId);
  const kind = d.library.kind === 'show' ? 'sonarr' : 'radarr';
  const toggle = (id: number) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const items = useMemo(() => d.titles.filter((t) => t.tmdbId && picked.has(t.tmdbId)).map((t) => ({ tmdbId: t.tmdbId, title: t.title, year: t.year })), [d.titles, picked]);
  const missing = d.titles.filter((t) => !t.inLibrary).length;
  const have = d.titles.length - missing;

  return (
    <Card>
      <CardHeader
        icon={LayoutGrid}
        title="Titles"
        subtitle={d.sourceKnown ? `What’s on the ${d.collection ? SOURCE_LABEL[d.collection.source.type] : 'list'}, and what you have` : 'In the collection on the server'}
        action={
          d.sourceKnown ? (
            <div role="tablist" className="flex gap-1.5">
              {(
                [
                  ['all', `All · ${d.titles.length}`],
                  ['have', `In library · ${have}`],
                  ['missing', `Missing · ${missing}`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn('h-8 rounded-xl border px-3 text-xs font-medium transition', tab === id ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04]')}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <CardBody>
        {admin && tab === 'missing' && pickable.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-brand/35 bg-brand/[0.1] px-4 py-2.5">
            <b className="text-[13px]">{picked.size} selected</b>
            <span className="text-xs text-ink-4">of {pickable.length} you can add</span>
            <Button size="sm" className="ml-2" onClick={() => setPicked(new Set(pickable.map((t) => t.tmdbId!)))}>Select all {pickable.length}</Button>
            {picked.size > 0 && <Button size="sm" onClick={() => setPicked(new Set())}>Clear</Button>}
            <Button variant="primary" size="sm" className="ml-auto" disabled={!picked.size} onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add {picked.size || ''} to {kind === 'radarr' ? 'Radarr' : 'Sonarr'}…
            </Button>
          </div>
        )}
        {!d.sourceKnown && d.collection && (d.collection.source.type === 'imdb_list' || d.collection.source.type === 'trakt_list') && (
          <p className="mb-4 text-xs text-ink-4">StreamForge can’t read {SOURCE_LABEL[d.collection.source.type]}s itself, so only what Kometa has built is shown here.</p>
        )}
        {!d.sourceKnown && d.collection && d.collection.source.type !== 'imdb_list' && d.collection.source.type !== 'trakt_list' && (
          <p className="mb-4 text-xs text-ink-4">Missing titles appear once StreamForge has a TMDb key: it reads Kometa’s from its config.yml, or add one in Settings → Kometa.</p>
        )}
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">{d.status === 'waiting' ? 'Kometa hasn’t built this collection yet.' : 'Nothing here.'}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3.5 sm:grid-cols-4 lg:grid-cols-6">
            {shown.map((t, n) => {
              const canPick = admin && tab === 'missing' && !!t.tmdbId;
              const on = !!t.tmdbId && picked.has(t.tmdbId);
              const body = (
                <>
                  <div className={cn('relative aspect-[2/3] overflow-hidden rounded-lg bg-surface-3 shadow-lg', on && 'outline-2 outline-offset-2 outline-brand')}>
                    {t.poster && <FadeImage src={posterSrc(t.poster)} alt="" className={cn('absolute inset-0', !t.inLibrary && 'opacity-40 grayscale-[.6]')} />}
                    {!t.inLibrary ? <span className="absolute top-1.5 left-1.5 rounded bg-bad/85 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-[#1a0a0e] uppercase">Missing</span> : t.new ? <span className="absolute top-1.5 left-1.5 rounded bg-ok/90 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-[#04140d] uppercase">New</span> : null}
                    {canPick && (
                      <span className={cn('absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-md border-2', on ? 'border-brand bg-brand text-[#0b0c14]' : 'border-white/70 bg-black/40')}>
                        {on && <Check className="size-3" strokeWidth={3} />}
                      </span>
                    )}
                  </div>
                  <div className={cn('mt-1.5 truncate text-[12.5px] font-medium', !t.inLibrary && 'text-ink-3')}>{t.title}</div>
                  <div className="text-[11px] text-ink-4">{t.year ?? ''}</div>
                </>
              );
              return (
                <li key={`${t.tmdbId ?? t.title}-${n}`}>
                  {canPick ? (
                    <button type="button" className="w-full text-left" aria-pressed={on} onClick={() => toggle(t.tmdbId!)}>{body}</button>
                  ) : t.tmdbId ? (
                    <Link to={`/media/${d.library.kind === 'show' ? 'tv' : 'movie'}/${t.tmdbId}`} className="block">{body}</Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {adding && (
        <AddToArrDialog
          kind={kind}
          items={items}
          from={d.name}
          onClose={() => setAdding(false)}
          onDone={() => setPicked(new Set())}
        />
      )}
    </Card>
  );
}

export default function KometaCollectionPage() {
  const { id = '' } = useParams();
  const q = useCollection(id);
  const all = useCollections();
  const del = useDeleteCollection();
  const nav = useNavigate();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const admin = !!user?.isAdmin;

  return (
    <>
      <Link to="/kometa" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Kometa
      </Link>
      <QueryState query={q} skeleton={<PageLoader label="Loading collection" />}>
        {(d) => {
          const st = STATUS[d.status];
          const c = d.collection;
          const serverName = { jellyfin: 'Jellyfin', plex: 'Plex', emby: 'Emby', silo: 'Silo' }[d.library.serverType];
          const missing = d.titles.filter((t) => !t.inLibrary && t.tmdbId).length;
          return (
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-3xl border border-line p-6 sm:p-7" style={{ background: `linear-gradient(120deg, color-mix(in oklab, ${KOMETA_COLOR} 22%, transparent), rgb(124 58 237 / .25)), var(--color-surface)` }}>
                <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
                  <div className="relative aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-surface-3 shadow-2xl sm:w-36">
                    {d.poster && <FadeImage src={jfImage(d.poster, 400)} alt="" className="absolute inset-0" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      {d.managed ? <Pill tone="brand">StreamForge</Pill> : <Pill>On the server</Pill>}
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight">{d.name}</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
                      <ServerTag type={d.library.serverType} name={`${serverName} · ${d.library.serverName} · ${d.library.name}`} />
                      {c && <><span>·</span><span>From {SOURCE_LABEL[c.source.type].replace(/^TMDb/, 'a TMDb').replace(/^IMDb/, 'an IMDb').replace(/^Trakt/, 'a Trakt')}</span></>}
                      {c && <><span>·</span><span>{c.schedule === 'always' ? 'Updates every run' : `Shown ${c.schedule.from} – ${c.schedule.to}`}</span></>}
                    </div>
                    {d.error && <p className="mt-2 text-sm text-warn">{d.error}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {d.openUrl && (
                        <a href={d.openUrl} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-black transition hover:brightness-110" style={{ background: `var(--color-${d.library.serverType})` }}>
                          Open on {serverName} <ExternalLink className="size-3.5" />
                        </a>
                      )}
                      {admin && c && <Button onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>}
                      {admin && c && (
                        <Button
                          variant="ghost"
                          className="text-bad hover:text-bad"
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm(`Remove “${d.name}” from StreamForge’s Kometa file? Kometa stops updating it; delete the collection on ${serverName} if you no longer want it.`)) del.mutate(d.id, { onSuccess: () => nav('/kometa') });
                          }}
                        >
                          <Trash2 className="size-4" /> Remove
                        </Button>
                      )}
                    </div>
                    {admin && missing > 0 && <p className="mt-2 text-xs text-ink-3">{missing} title{missing === 1 ? '' : 's'} on the list aren’t in your library. Open the Missing tab below to add them.</p>}
                  </div>
                </div>
              </div>

              <div className="grid items-start gap-5 xl:grid-cols-3">
                <div className="min-w-0 space-y-5 xl:col-span-2">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat value={d.counts.onList ?? '—'} label={d.sourceKnown ? 'Titles on the list' : 'On the list (unknown)'} />
                    <Stat value={d.counts.inLibrary} label="In your library" tone="var(--color-ok)" />
                    <Stat value={d.counts.missing ?? '—'} label="Missing" tone={d.counts.missing ? 'var(--color-warn)' : undefined} />
                    <Stat value={d.counts.inCollection} label="In the collection now" />
                  </div>
                  <Titles d={d} admin={admin} />
                </div>
                <div className="min-w-0 space-y-5">
                  {c && (
                    <Card>
                      <CardHeader icon={Settings2} title="Settings" subtitle="What StreamForge asks Kometa to do" />
                      <CardBody>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
                          <dt className="text-ink-4">Source</dt><dd className="text-right text-ink-2">{SOURCE_LABEL[c.source.type]}{c.source.value ? ` · ${c.source.value.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)}` : ''}{c.source.limit ? ` · ${c.source.limit} titles` : ''}{c.source.ids ? ` · ${c.source.ids.length} titles` : ''}</dd>
                          <dt className="text-ink-4">Shown</dt><dd className="text-right text-ink-2">{c.schedule === 'always' ? 'Always' : `${c.schedule.from} – ${c.schedule.to}`}</dd>
                          <dt className="text-ink-4">Order</dt><dd className="text-right text-ink-2">{{ custom: 'Same as the list', release: 'Release date', alpha: 'Alphabetical' }[c.order]}</dd>
                          <dt className="text-ink-4">Missing titles</dt><dd className="text-right text-ink-2">{c.addMissing ? `Sent to ${d.library.kind === 'show' ? 'Sonarr' : 'Radarr'}` : 'Left out'}</dd>
                          {d.library.serverType === 'plex' && <><dt className="text-ink-4">Plex Home screen</dt><dd className="text-right text-ink-2">{c.visibleHome ? 'Shown' : 'Not shown'}</dd></>}
                          <dt className="text-ink-4">Added</dt><dd className="text-right text-ink-2">{relative(c.createdAt)}{c.createdBy ? `, by ${c.createdBy}` : ''}</dd>
                        </dl>
                      </CardBody>
                    </Card>
                  )}
                  <Card>
                    <CardHeader icon={History} title="History" subtitle="From Kometa’s run reports" />
                    <CardBody>
                      {d.history.length ? (
                        <ul className="space-y-3">
                          {d.history.map((h, n) => (
                            <li key={n} className="flex gap-2.5 text-[12.5px]">
                              <i className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: h.event === 'error' ? 'var(--color-warn)' : h.event === 'delete' ? 'var(--color-bad)' : h.created ? 'var(--color-brand)' : 'var(--color-ok)' }} />
                              <div className="min-w-0">
                                <div className="text-ink-2">
                                  {h.event === 'error'
                                    ? h.error
                                    : h.event === 'delete'
                                      ? h.message
                                      : `${h.created ? 'Created' : 'Updated'}${h.addedCount ? ` · +${h.addedCount}${h.additions?.length ? ` (${h.additions.slice(0, 3).join(', ')}${h.additions.length > 3 ? '…' : ''})` : ''}` : ''}${h.removedCount ? ` · −${h.removedCount}` : ''}`}
                                </div>
                                <div className="text-[11px] text-ink-4">{relative(h.at)}</div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-ink-4">Nothing yet. Kometa’s webhooks report each change here (Settings → Kometa).</p>
                      )}
                    </CardBody>
                  </Card>
                  {d.yaml && (
                    <Card>
                      <CardHeader icon={Code2} title="Kometa config" subtitle={`In ${d.kometaFile} · read-only`} />
                      <CardBody>
                        <pre className="overflow-x-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{d.yaml}</pre>
                      </CardBody>
                    </Card>
                  )}
                </div>
              </div>
              {editing && c && all.data && (
                <CollectionForm
                  id={c.id}
                  libraries={all.data.libraries}
                  nextRun={all.data.nextRun}
                  initial={{ name: c.name, library: { server: c.library.server, id: c.library.id }, source: c.source, schedule: c.schedule, order: c.order, addMissing: c.addMissing, visibleHome: c.visibleHome }}
                  onClose={() => setEditing(false)}
                  onSaved={() => void q.refetch()}
                />
              )}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}

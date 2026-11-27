import { useState } from 'react';
import { BookAudio, Check, Clock, HardDrive, Headphones, History, Library, LoaderCircle, Podcast, RefreshCw, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useAudiobookshelf, useAudiobookshelfScan } from '@/hooks/useServices';
import { bytes, clock, duration, num, relative } from '@/lib/format';
import { ServiceHeader } from '@/components/layout/ServiceHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { FadeImage } from '@/components/ui/Image';
import { ProgressBar } from '@/components/ui/Progress';
import { StatTile } from '@/components/ui/Stat';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { t } from '@/i18n';

const COLOR = 'var(--color-audiobookshelf)';
/** Library totals run to thousands of hours: show whole hours. */
const hours = (sec: number) => t('svc.abs.hours', { n: num(Math.round(sec / 3600)) });
const KindIcon = ({ kind, className }: { kind: 'book' | 'podcast'; className?: string }) => (kind === 'podcast' ? <Podcast className={className} /> : <BookAudio className={className} />);
/** Shown when an item has no cover. */
const NoCover = ({ kind }: { kind: 'book' | 'podcast' }) => (
  <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface-2 text-ink-4">
    <KindIcon kind={kind} className="size-1/3 max-h-8 max-w-8" />
  </div>
);

export default function AudiobookshelfPage() {
  const q = useAudiobookshelf();
  const { user } = useAuth();
  const scan = useAudiobookshelfScan();
  const [scanned, setScanned] = useState<Set<string>>(new Set());

  return (
    <>
      <ServiceHeader id="audiobookshelf" />
      <QueryState query={q} skeleton={<PageLoader label={t('svc.abs.loading')} hint={t('svc.abs.loadingHint')} />}>
        {(d) => (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label={t('svc.abs.books')} value={d.totals.books} icon={BookAudio} accent={COLOR} />
              <StatTile label={t('svc.abs.podcasts')} value={d.totals.podcasts} icon={Podcast} accent={COLOR} />
              <StatTile label={t('svc.abs.duration')} value={d.totals.duration} icon={Clock} accent={COLOR} format={hours} />
              <StatTile label={t('svc.onDisk')} value={d.totals.size} icon={HardDrive} accent="var(--color-infinidisk)" format={(n) => bytes(n)} />
            </div>

            <div className="grid items-start gap-5 xl:grid-cols-2">
              <Card>
                <CardHeader icon={Headphones} accent={COLOR} title={t('svc.abs.listening')} subtitle={t('svc.abs.listeningCount', { count: d.listening.length })} />
                <CardBody>
                  {!d.listening.length ? (
                    <EmptyState icon={Headphones} title={t('svc.abs.nobody')} description={t('svc.abs.nobodyHint')} />
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.listening.map((s) => (
                        <li key={s.id} className="flex items-center gap-3 py-2.5">
                          <FadeImage src={s.cover} alt="" className="size-12 shrink-0 rounded-md ring-1 ring-white/10" fallback={<NoCover kind={s.kind} />} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium">{s.title}{s.author ? <span className="font-normal text-ink-3"> · {s.author}</span> : null}</div>
                            <div className="truncate text-[11px] text-ink-4">{[s.user, s.device].filter(Boolean).join(' · ')}</div>
                            <div className="mt-1.5 flex items-center gap-2">
                              <ProgressBar value={s.duration ? s.position / s.duration : 0} color={COLOR} glow={false} height={4} />
                              <span className="shrink-0 text-[11px] text-ink-4 tabular-nums">{clock(s.position * 1000)} / {clock(s.duration * 1000)}</span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader icon={Library} accent={COLOR} title={t('svc.abs.libraries')} subtitle={t('svc.abs.librariesCount', { count: d.libraries.length })} />
                <CardBody>
                  {!d.libraries.length ? (
                    <EmptyState icon={Library} title={t('svc.abs.noLibraries')} />
                  ) : (
                    <ul className="divide-y divide-line">
                      {d.libraries.map((l) => {
                        const busy = scan.isPending && scan.variables?.id === l.id;
                        const done = scanned.has(l.id);
                        return (
                          <li key={l.id} className="flex items-center gap-3 py-2.5">
                            <KindIcon kind={l.kind} className="size-4 shrink-0 text-audiobookshelf" />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium">{l.name}</div>
                              <div className="truncate text-[11px] text-ink-4">
                                {[
                                  t(l.kind === 'podcast' ? 'svc.abs.podcastCount' : 'svc.abs.bookCount', { count: l.items }),
                                  l.kind === 'book' && l.authors ? t('svc.abs.authorCount', { count: l.authors }) : undefined,
                                  hours(l.duration),
                                  bytes(l.size),
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </div>
                            {user?.isAdmin && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy || done}
                                aria-label={t('svc.abs.scanLibrary', { name: l.name })}
                                onClick={() => scan.mutate({ id: l.id, name: l.name }, { onSuccess: () => setScanned((s) => new Set(s).add(l.id)) })}
                              >
                                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : done ? <Check className="size-3.5 text-ok" /> : <RefreshCw className="size-3.5" />}
                                {done ? t('svc.abs.scanning') : t('svc.abs.scan')}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {scan.error && <p className="mt-2 text-xs text-bad" role="alert">{(scan.error as Error).message}</p>}
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader icon={Sparkles} accent={COLOR} title={t('svc.abs.recent')} subtitle={t('svc.abs.recentHint')} />
              <CardBody>
                {!d.recentlyAdded.length ? (
                  <EmptyState icon={Sparkles} title={t('svc.abs.noRecent')} />
                ) : (
                  <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-9">
                    {d.recentlyAdded.map((i) => (
                      <li key={i.id} className="min-w-0">
                        <FadeImage src={i.cover} alt="" className="aspect-square w-full rounded-lg ring-1 ring-white/10" fallback={<NoCover kind={i.kind} />} />
                        <div className="mt-1.5 truncate text-[12px] font-medium" title={i.title}>{i.title}</div>
                        <div className="truncate text-[11px] text-ink-4" title={i.author}>{i.author ?? (i.series || '')}</div>
                        <div className="truncate text-[10px] text-ink-4">
                          {[i.kind === 'podcast' && i.episodes ? t('svc.abs.episodeCount', { count: i.episodes }) : i.duration ? duration(i.duration * 1000) : undefined, i.addedAt ? relative(i.addedAt) : undefined]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={History} accent={COLOR} title={t('svc.abs.history')} subtitle={t('svc.abs.historyHint')} />
              <CardBody>
                {!d.recentSessions.length ? (
                  <EmptyState icon={History} title={t('svc.abs.noHistory')} description={t('svc.abs.noHistoryHint')} />
                ) : (
                  <ul className="divide-y divide-line">
                    {d.recentSessions.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2">
                        <KindIcon kind={s.kind} className="size-4 shrink-0 text-audiobookshelf" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{s.title}{s.author ? <span className="font-normal text-ink-3"> · {s.author}</span> : null}</div>
                          <div className="truncate text-[11px] text-ink-4">{[s.user, s.device, s.listened ? t('svc.abs.listened', { time: duration(s.listened * 1000) }) : undefined].filter(Boolean).join(' · ')}</div>
                        </div>
                        {s.at && <span className="shrink-0 text-[11px] text-ink-4">{relative(s.at)}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </QueryState>
    </>
  );
}

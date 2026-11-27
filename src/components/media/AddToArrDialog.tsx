import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, LoaderCircle, X } from 'lucide-react';
import { api } from '@/lib/api';
import { bytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { t } from '@/i18n';

export type ArrKind = 'sonarr' | 'radarr';

export interface AddItem {
  tmdbId?: number;
  tvdbId?: number;
  title?: string;
  year?: number;
}

interface Options {
  instance: string;
  instances: { id: string; name: string; primary: boolean }[];
  profiles: { id: number; name: string }[];
  roots: { path: string; freeSpace?: number; accessible: boolean }[];
  defaults: {
    qualityProfileId?: number;
    rootFolderPath?: string;
    minimumAvailability?: 'announced' | 'inCinemas' | 'released';
    seriesMonitor?: string;
    monitored: boolean;
    search: boolean;
    tag: boolean;
  };
}

interface Checked {
  key: string;
  title: string;
  year?: number;
  status: 'new' | 'exists' | 'invalid';
  instance?: string;
}

interface Result {
  key: string;
  title: string;
  status: 'added' | 'skipped' | 'failed';
  message?: string;
}

const SERIES_MONITOR = ['all', 'future', 'missing', 'existing', 'firstSeason', 'lastSeason', 'pilot', 'none'] as const;

const select =
  'h-10 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink outline-none transition focus:border-brand/60 focus:ring-4 focus:ring-brand/10 [&>option]:bg-surface-2';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-3">{label}</span>
      {children}
    </label>
  );
}

/**
 * Adds one or many titles to Sonarr or Radarr with the usual choices
 * (instance, quality profile, root folder, …). Titles already in any instance
 * are listed and skipped. Shows each title's result once done.
 */
export function AddToArrDialog({
  kind,
  items,
  from,
  onClose,
  onDone,
}: {
  kind: ArrKind;
  items: AddItem[];
  /** Where the titles came from, e.g. "Oscar Winners", for the subtitle and audit log. */
  from?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [instance, setInstance] = useState<string>();
  const opts = useQuery({
    queryKey: ['arr-add-options', kind, instance ?? 'default'],
    queryFn: () => api<Options>(`/arr/add-options?kind=${kind}${instance ? `&instance=${encodeURIComponent(instance)}` : ''}`),
  });
  const check = useQuery({
    queryKey: ['arr-add-check', kind, items.map((i) => i.tmdbId ?? i.tvdbId).join(',')],
    queryFn: () => api<{ items: Checked[] }>('/arr/add-check', { method: 'POST', body: { kind, items } }),
  });
  const [choices, setChoices] = useState<Options['defaults']>();
  useEffect(() => {
    if (opts.data) setChoices(opts.data.defaults);
  }, [opts.data]);
  const add = useMutation({
    mutationFn: () =>
      api<{ instance: string; results: Result[]; searching: boolean }>('/arr/add', {
        method: 'POST',
        body: { kind, instance: opts.data?.instance, items: items.filter((_, n) => check.data?.items[n]?.status === 'new'), choices, from },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['media'] });
      void qc.invalidateQueries({ queryKey: ['kometa'] });
      onDone?.();
    },
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !add.isPending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [add.isPending, onClose]);

  const name = kind === 'radarr' ? 'Radarr' : 'Sonarr';
  const plural = (n: number) => t(kind === 'radarr' ? 'media.add.movies' : 'media.add.series', { count: n });
  const toAdd = check.data?.items.filter((i) => i.status === 'new').length ?? 0;
  const results = useMemo(() => new Map(add.data?.results.map((r) => [r.key, r])), [add.data]);
  const done = !!add.data;
  const ready = !!choices?.qualityProfileId && !!choices.rootFolderPath && toAdd > 0;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={() => !add.isPending && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="arr-add-h"
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-2xl"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-2">
          <div className="min-w-0 flex-1">
            <h2 id="arr-add-h" className="text-lg font-semibold">
              {done ? t('palette.addedTo', { instance: add.data!.instance }) : t('media.add.title', { what: items.length === 1 ? (items[0]!.title ?? plural(1)) : plural(items.length), app: name })}
            </h2>
            {from && <p className="mt-0.5 text-xs text-ink-4">{t('media.from', { server: from })}</p>}
          </div>
          <button onClick={onClose} disabled={add.isPending} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-white/5 hover:text-ink" aria-label={t('media.close')}>
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-3">
          {opts.isError ? (
            <p className="text-sm text-bad" role="alert">{(opts.error as Error).message}</p>
          ) : !opts.data || !choices ? (
            <div className="flex items-center gap-2 py-6 text-sm text-ink-3"><LoaderCircle className="size-4 animate-spin" /> {t('media.add.asking', { app: name })}</div>
          ) : (
            !done && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('media.add.instance', { app: name })}>
                    <select className={select} value={opts.data.instance} onChange={(e) => setInstance(e.target.value)} disabled={opts.data.instances.length < 2}>
                      {opts.data.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('media.add.profile')}>
                    <select className={select} value={choices.qualityProfileId} onChange={(e) => setChoices({ ...choices, qualityProfileId: Number(e.target.value) })}>
                      {opts.data.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('media.add.root')}>
                    <select className={select} value={choices.rootFolderPath} onChange={(e) => setChoices({ ...choices, rootFolderPath: e.target.value })}>
                      {opts.data.roots.map((r) => (
                        <option key={r.path} value={r.path} disabled={!r.accessible}>
                          {r.path}{r.freeSpace !== undefined ? ` · ${t('library.dl.free', { size: bytes(r.freeSpace) })}` : ''}{r.accessible ? '' : ` · ${t('media.add.unreachable')}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {kind === 'radarr' ? (
                    <Field label={t('media.add.minAvail')}>
                      <select className={select} value={choices.minimumAvailability} onChange={(e) => setChoices({ ...choices, minimumAvailability: e.target.value as Options['defaults']['minimumAvailability'] })}>
                        <option value="announced">{t('media.add.announced')}</option>
                        <option value="inCinemas">{t('widgets.upcoming.cinema')}</option>
                        <option value="released">{t('media.released')}</option>
                      </select>
                    </Field>
                  ) : (
                    <Field label={t('media.add.monitor')}>
                      <select className={select} value={choices.seriesMonitor} onChange={(e) => setChoices({ ...choices, seriesMonitor: e.target.value })}>
                        {SERIES_MONITOR.map((v) => <option key={v} value={v}>{t(`media.add.monitorOpt.${v}`)}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={choices.monitored} onChange={(v) => setChoices({ ...choices, monitored: v, search: v && choices.search })} label={t('media.add.monitor')} />{t('media.add.monitor')}</span>
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={choices.search && choices.monitored} disabled={!choices.monitored} onChange={(v) => setChoices({ ...choices, search: v })} label={t('media.searchNow')} />{t('media.searchNow')}</span>
                  <span className="inline-flex items-center gap-2 text-[13px] text-ink-2"><Switch checked={choices.tag} onChange={(v) => setChoices({ ...choices, tag: v })} label={t('media.add.tag')} />{t('media.add.tag')}</span>
                </div>
              </>
            )
          )}

          <div>
            <div className="mb-1.5 text-xs font-medium text-ink-3">{t('media.add.titles')}</div>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {!check.data ? (
                <li className="flex items-center gap-2 px-3 py-3 text-xs text-ink-3"><LoaderCircle className="size-3.5 animate-spin" /> {t('media.add.checking', { app: name })}</li>
              ) : (
                check.data.items.map((c) => {
                  const r = results.get(c.key);
                  return (
                    <li key={c.key} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">
                        {r?.title ?? c.title} {c.year && <span className="text-ink-4">({c.year})</span>}
                      </span>
                      {r ? (
                        <span className={cn('inline-flex shrink-0 items-center gap-1 text-[11.5px]', r.status === 'added' ? 'text-ok' : r.status === 'failed' ? 'text-bad' : 'text-ink-4')}>
                          {r.status === 'added' ? <Check className="size-3.5" /> : r.status === 'failed' ? <CircleAlert className="size-3.5" /> : null}
                          {r.status === 'added' ? t('media.added') : r.message}
                        </span>
                      ) : c.status === 'new' ? (
                        <span className="shrink-0 text-[11.5px] text-ok">{add.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : t('media.add.will')}</span>
                      ) : (
                        <span className="shrink-0 text-[11.5px] text-ink-4">{c.status === 'exists' ? t('media.add.exists', { instance: c.instance }) : t('media.add.noId')}</span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          {add.error && <p className="text-xs text-bad" role="alert">{(add.error as Error).message}</p>}
          {done && add.data!.searching && <p className="text-xs text-ink-3">{t('media.add.searching', { app: name })}</p>}
          {!done && choices?.search && choices.monitored && toAdd > 1 && <p className="text-xs text-ink-4">{t('media.add.oneByOne', { app: name })}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-6 py-4">
          <span className="mr-auto text-[11px] text-ink-4">{done ? '' : t('media.add.remembered')}</span>
          {done ? (
            <Button variant="primary" onClick={onClose}>{t('common.done')}</Button>
          ) : (
            <>
              <Button onClick={onClose} disabled={add.isPending}>{t('media.cancel')}</Button>
              <Button variant="primary" disabled={!ready || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {toAdd ? t('media.add.add', { what: plural(toAdd) }) : t('media.add.nothing')}
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

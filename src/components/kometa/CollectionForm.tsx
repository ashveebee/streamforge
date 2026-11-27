import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { LoaderCircle, X } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { SERVER_NAME, SOURCE_LABEL, useSaveCollection, type CollectionInput, type Library, type SourceType } from '@/hooks/useKometa';
import { getLocale } from '@/i18n';

const input =
  'h-10 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 outline-none transition focus:border-brand/60 focus:ring-4 focus:ring-brand/10 aria-[invalid=true]:border-bad/60 [&>option]:bg-surface-2 [&>optgroup]:bg-surface-2';

const SOURCES: SourceType[] = ['tmdb_list', 'imdb_list', 'trakt_list', 'tmdb_trending_weekly', 'tmdb_popular', 'tmdb_keyword', 'manual'];

const PLACEHOLDER: Partial<Record<SourceType, string>> = {
  tmdb_list: 'TMDb list id or address, like 28 or https://www.themoviedb.org/list/28',
  imdb_list: 'https://www.imdb.com/list/ls000096828/',
  trakt_list: 'https://trakt.tv/users/…/lists/…',
  tmdb_keyword: 'TMDb keyword id or address, like 207317',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-4">{hint}</span>}
    </label>
  );
}

/** Adding or editing a collection that StreamForge asks Kometa to build. */
export function CollectionForm({
  libraries,
  initial,
  id,
  nextRun,
  onClose,
  onSaved,
}: {
  libraries: Library[];
  initial?: CollectionInput;
  id?: string;
  nextRun?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const save = useSaveCollection();
  const first = libraries[0];
  const [f, setF] = useState<CollectionInput>(
    initial ?? {
      name: '',
      library: { server: first?.server ?? '', id: first?.id ?? '' },
      source: { type: 'tmdb_list', value: '' },
      schedule: 'always',
      order: 'custom',
      addMissing: false,
      visibleHome: false,
    },
  );
  const [ids, setIds] = useState((initial?.source.ids ?? []).join(', '));
  const lib = libraries.find((l) => l.server === f.library.server && l.id === f.library.id);
  const err = save.error instanceof ApiError ? save.error : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const servers = [...new Map(libraries.map((l) => [l.server, l])).values()];
  const listSource = ['tmdb_list', 'imdb_list', 'trakt_list', 'tmdb_keyword'].includes(f.source.type);
  const counted = f.source.type === 'tmdb_trending_weekly' || f.source.type === 'tmdb_popular';
  const arr = lib?.kind === 'show' ? 'Sonarr' : 'Radarr';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const source = f.source.type === 'manual' ? { type: 'manual' as const, ids: ids.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0) } : f.source;
    const r = await save.mutateAsync({ ...f, id, source }).catch(() => undefined);
    if (r) {
      onSaved?.(r.id);
      onClose();
    }
  }

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseDown={onClose}
    >
      <motion.form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="col-form-h"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-2xl"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onMouseDown={(e) => e.stopPropagation()}
        noValidate
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-1">
          <div className="min-w-0 flex-1">
            <h2 id="col-form-h" className="text-lg font-semibold">{id ? 'Edit collection' : 'New collection'}</h2>
            <p className="mt-0.5 text-xs text-ink-4">Saved in StreamForge’s own Kometa file. Your other Kometa files aren’t touched.</p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-white/5 hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className={input} value={f.name} autoFocus placeholder="Christmas Movies" aria-invalid={err?.code === 'name'} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label="Library" hint={lib && lib.serverType !== 'plex' ? 'Jellyfin and Emby libraries need Kometa’s develop build for now.' : undefined}>
              <select
                className={input}
                value={`${f.library.server}|${f.library.id}`}
                onChange={(e) => {
                  const [server, lid] = e.target.value.split('|');
                  setF({ ...f, library: { server: server!, id: lid! } });
                }}
              >
                {servers.map((s) => (
                  <optgroup key={s.server} label={`${SERVER_NAME[s.serverType]} · ${s.serverName}`}>
                    {libraries
                      .filter((l) => l.server === s.server)
                      .map((l) => (
                        <option key={l.id} value={`${l.server}|${l.id}`}>
                          {l.name}
                          {l.serverType !== 'plex' ? ' · needs Kometa develop build' : ''}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-3">Build it from</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Build it from">
              {SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={f.source.type === s}
                  onClick={() => setF({ ...f, source: { type: s, value: s === f.source.type ? f.source.value : '', limit: s === 'tmdb_trending_weekly' || s === 'tmdb_popular' ? 30 : undefined } })}
                  className={cn(
                    'h-8 rounded-lg border px-3 text-xs font-medium transition',
                    f.source.type === s ? 'border-white/20 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
                  )}
                >
                  {SOURCE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {listSource && (
            <Field label={`${SOURCE_LABEL[f.source.type]} ${f.source.type === 'tmdb_keyword' ? 'id' : 'address'}`} hint={f.source.type === 'trakt_list' ? 'Trakt lists need Trakt connected in Kometa’s config.' : undefined}>
              <input className={input} value={f.source.value ?? ''} placeholder={PLACEHOLDER[f.source.type]} spellCheck={false} aria-invalid={err?.code === 'source'} onChange={(e) => setF({ ...f, source: { ...f.source, value: e.target.value } })} />
            </Field>
          )}
          {counted && (
            <Field label="How many titles">
              <input className={input} type="number" min={1} max={200} value={f.source.limit ?? 30} onChange={(e) => setF({ ...f, source: { ...f.source, limit: Math.max(1, Math.min(200, Number(e.target.value) || 30)) } })} />
            </Field>
          )}
          {f.source.type === 'manual' && (
            <Field label="TMDb ids" hint="Separate with commas. The number at the end of a title’s themoviedb.org address.">
              <input className={input} value={ids} placeholder="603, 604, 605" spellCheck={false} aria-invalid={err?.code === 'source'} onChange={(e) => setIds(e.target.value)} />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Show it">
              <select className={input} value={f.schedule === 'always' ? 'always' : 'range'} onChange={(e) => setF({ ...f, schedule: e.target.value === 'always' ? 'always' : { from: '12/01', to: '12/31' } })}>
                <option value="always">Always</option>
                <option value="range">Only between dates</option>
              </select>
            </Field>
            {f.schedule !== 'always' ? (
              <>
                <Field label="From (month/day)">
                  <input className={input} value={f.schedule.from} placeholder="12/01" aria-invalid={err?.code === 'schedule'} onChange={(e) => setF({ ...f, schedule: { ...(f.schedule as { from: string; to: string }), from: e.target.value } })} />
                </Field>
                <Field label="To (month/day)">
                  <input className={input} value={f.schedule.to} placeholder="12/31" aria-invalid={err?.code === 'schedule'} onChange={(e) => setF({ ...f, schedule: { ...(f.schedule as { from: string; to: string }), to: e.target.value } })} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Order">
                  <select className={input} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value as CollectionInput['order'] })}>
                    <option value="custom">Same as the list</option>
                    <option value="release">Release date</option>
                    <option value="alpha">Alphabetical</option>
                  </select>
                </Field>
                <Field label="Missing titles">
                  <select className={input} value={f.addMissing ? 'arr' : 'skip'} onChange={(e) => setF({ ...f, addMissing: e.target.value === 'arr' })}>
                    <option value="skip">Leave them out</option>
                    <option value="arr">Send to {arr}</option>
                  </select>
                </Field>
              </>
            )}
          </div>
          {f.schedule !== 'always' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Order">
                <select className={input} value={f.order} onChange={(e) => setF({ ...f, order: e.target.value as CollectionInput['order'] })}>
                  <option value="custom">Same as the list</option>
                  <option value="release">Release date</option>
                  <option value="alpha">Alphabetical</option>
                </select>
              </Field>
              <Field label="Missing titles">
                <select className={input} value={f.addMissing ? 'arr' : 'skip'} onChange={(e) => setF({ ...f, addMissing: e.target.value === 'arr' })}>
                  <option value="skip">Leave them out</option>
                  <option value="arr">Send to {arr}</option>
                </select>
              </Field>
            </div>
          )}
          {lib?.serverType === 'plex' && (
            <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
              <Switch checked={f.visibleHome} onChange={(v) => setF({ ...f, visibleHome: v })} label="Show on Plex’s Home screen" />
              Show on Plex’s Home screen <span className="text-[11px] text-ink-4">· needs Plex Pass</span>
            </span>
          )}
          {err && <p className="text-xs text-bad" role="alert">{err.message}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-6 py-4">
          <span className="mr-auto text-[11px] text-ink-4">
            {nextRun ? `Builds on Kometa’s next run, ${new Date(nextRun).toLocaleString(getLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.` : 'Builds on Kometa’s next run.'}
          </span>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending || !f.name.trim() || !lib}>
            {save.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {id ? 'Save' : 'Add collection'}
          </Button>
        </div>
      </motion.form>
    </motion.div>,
    document.body,
  );
}

/** A dot in the server's colour with its name. */
export { ServerTag } from '@/components/ui/ServerTag';

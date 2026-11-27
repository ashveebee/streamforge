import { Component, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Check,
  CornerDownLeft,
  Download,
  LayoutDashboard,
  LoaderCircle,
  Newspaper,
  Plus,
  PlayCircle,
  ScrollText,
  Search,
  Send,
  Settings,
  Radar,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCanSee, useMainServer, useServiceConfig } from '@/hooks/queries';
import { useAddMedia, useGlobalSearch, useRequestMedia, type SearchHit } from '@/hooks/useSearch';
import { cn } from '@/lib/cn';
import type { ServiceId } from '@/lib/types';
import { FadeImage } from '../ui/Image';
import { MEDIA_SERVERS, SERVICES } from '../ui/ServiceIcon';
import { Pill } from '../ui/Status';

interface PageCmd {
  key: string;
  label: string;
  path: string;
  icon: typeof Search;
  keywords?: string;
}

function usePages(): PageCmd[] {
  const { user } = useAuth();
  const canSee = useCanSee();
  const cfg = useServiceConfig().data;
  return useMemo(() => {
    const out: PageCmd[] = [
      { key: 'p:/', label: 'Overview', path: '/', icon: LayoutDashboard, keywords: 'dashboard home' },
      { key: 'p:/digest', label: 'Weekly digest', path: '/digest', icon: Newspaper, keywords: 'this week new added newsletter' },
      { key: 'p:/me', label: 'My activity', path: '/me', icon: UserRound, keywords: 'history requests continue watching devices profile' },
    ];
    if (canSee('now-playing')) out.push({ key: 'p:/now-playing', label: 'Now Playing', path: '/now-playing', icon: PlayCircle, keywords: 'streams sessions' });
    if (canSee('stats')) out.push({ key: 'p:/stats', label: 'Stats', path: '/stats', icon: BarChart3, keywords: 'plays watch time' });
    if (canSee('library')) out.push({ key: 'p:/library', label: 'Library health', path: '/library', icon: Stethoscope, keywords: 'missing upgrades cleanup unwatched' });
    if (canSee('downloads') && cfg?.downloadClients) out.push({ key: 'p:/downloads', label: 'Downloads', path: '/downloads', icon: Download, keywords: 'qbittorrent sabnzbd transmission nzbget torrents' });
    if (canSee('system')) out.push({ key: 'p:/system', label: 'System Status', path: '/system', icon: Activity, keywords: 'health cpu disk' });
    if (user?.isAdmin) {
      out.push({ key: 'p:/settings', label: 'Settings', path: '/settings', icon: Settings, keywords: 'configure services api key connect' });
      out.push({ key: 'p:/settings/downloads', label: 'Settings · Download clients', path: '/settings/downloads', icon: Settings, keywords: 'qbittorrent transmission sabnzbd nzbget' });
      out.push({ key: 'p:/settings/notifications', label: 'Settings · Notifications', path: '/settings/notifications', icon: Settings, keywords: 'alerts discord ntfy pushover webhook push' });
      out.push({ key: 'p:/settings/access', label: 'Settings · Access', path: '/settings/access', icon: Settings, keywords: 'members users sign in sso oidc authentik' });
      out.push({ key: 'p:/settings/system', label: 'Settings · Updates & backup', path: '/settings/system', icon: Settings, keywords: 'update version release backup restore' });
      out.push({ key: 'p:/audit', label: 'Audit log', path: '/audit', icon: ScrollText, keywords: 'security history changes' });
      out.push({ key: 'p:/now-playing/buffering', label: 'Why did it buffer?', path: '/now-playing/buffering', icon: Radar, keywords: 'buffering stall lag stutter diagnose' });
      out.push({ key: 'p:/rules', label: 'Rules', path: '/rules', icon: Sparkles, keywords: 'automation alerts if then' });
    }
    for (const id of Object.keys(SERVICES) as ServiceId[]) {
      if (cfg && !cfg.enabled[id]) continue;
      out.push({ key: `p:${SERVICES[id].path}`, label: SERVICES[id].name, path: SERVICES[id].path, icon: SERVICES[id].icon, keywords: SERVICES[id].tagline });
    }
    // Emby and Plex pages, once a server of that kind is set up.
    for (const t of ['emby', 'plex'] as const) {
      if (!cfg?.jellyfinServers?.some((s) => s.type === t) || (cfg && !cfg.enabled.jellyfin)) continue;
      const m = MEDIA_SERVERS[t];
      out.push({ key: `p:${m.path}`, label: m.name, path: m.path, icon: m.icon, keywords: m.tagline });
    }
    return out;
  }, [user?.isAdmin, canSee, cfg]);
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' }> = {
  available: { label: 'Available', tone: 'ok' },
  downloaded: { label: 'Downloaded', tone: 'ok' },
  partial: { label: 'Partly available', tone: 'brand' },
  requested: { label: 'Requested', tone: 'brand' },
  processing: { label: 'Processing', tone: 'brand' },
  missing: { label: 'Missing', tone: 'warn' },
};

/** Whether a discover hit can still be requested or added. */
const requestable = (h: SearchHit) => !!h.mediaType && !!h.tmdbId && (h.status === 'none' || (h.status === 'partial' && h.mediaType === 'tv'));

function DiscoverActions({ hit, canRequest, canAdd, trigger }: { hit: SearchHit; canRequest: boolean; canAdd: boolean; trigger: number }) {
  const request = useRequestMedia();
  const add = useAddMedia();
  const busy = request.isPending || add.isPending;
  const doRequest = () => request.mutate({ mediaType: hit.mediaType!, tmdbId: hit.tmdbId!, title: hit.title });
  // Enter on the row requests it (or adds it, without Seerr).
  useEffect(() => {
    if (!trigger || busy || request.isSuccess || add.isSuccess || !requestable(hit)) return;
    if (canRequest) doRequest();
    else if (canAdd && hit.status === 'none') add.mutate({ kind: hit.mediaType === 'tv' ? 'sonarr' : 'radarr', tmdbId: hit.tmdbId, tvdbId: hit.tvdbId, title: hit.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  if (!requestable(hit)) return null;
  const err = (request.error ?? add.error) as Error | null;
  if (request.isSuccess || add.isSuccess) {
    return <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ok"><Check className="size-3.5" /> {request.isSuccess ? 'Requested' : `Added to ${add.data?.instance}`}</span>;
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        {canRequest && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              doRequest();
            }}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-brand/15 px-2 text-[11px] font-medium text-brand transition hover:bg-brand/25 disabled:opacity-50"
          >
            {request.isPending ? <LoaderCircle className="size-3 animate-spin" /> : <Send className="size-3" />} {hit.status === 'partial' ? 'Request the rest' : 'Request'}
          </button>
        )}
        {canAdd && hit.status === 'none' && (
          <button
            type="button"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              add.mutate({ kind: hit.mediaType === 'tv' ? 'sonarr' : 'radarr', tmdbId: hit.tmdbId, tvdbId: hit.tvdbId, title: hit.title });
            }}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-line-strong px-2 text-[11px] font-medium text-ink-2 transition hover:bg-white/[0.06] disabled:opacity-50"
            title={`Add to ${hit.mediaType === 'tv' ? 'Sonarr' : 'Radarr'} and search now`}
          >
            {add.isPending ? <LoaderCircle className="size-3 animate-spin" /> : <Plus className="size-3" />} {hit.mediaType === 'tv' ? 'Sonarr' : 'Radarr'}
          </button>
        )}
      </div>
      {err && <span role="alert" className="max-w-72 text-right text-[11px] leading-snug text-bad">{err.message}</span>}
    </div>
  );
}

/** Keeps a bad search result from taking the whole page down. */
class PaletteBoundary extends Component<{ children: React.ReactNode; onReset: () => void }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[search]', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-sm text-bad">Search hit a problem: {this.state.error.message}</p>
        <button
          className="mt-3 rounded-lg border border-line-strong px-3 py-1.5 text-xs text-ink-2 hover:bg-white/[0.06]"
          onClick={() => {
            this.setState({ error: undefined });
            this.props.onReset();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const main = useMainServer();
  const cfgRequests = useServiceConfig().data?.requests;
  const [text, setText] = useState('');
  const q = useDeferredValue(text.trim());
  const pages = usePages();
  const res = useGlobalSearch(q);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  // Bumped when Enter is pressed on a discover row, which then requests it.
  const [trigger, setTrigger] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const shiftKey = useRef(false);

  useEffect(() => {
    if (open) {
      setText('');
      setActive(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  const n = q.toLowerCase();
  const pageHits = pages.filter((p) => !n || p.label.toLowerCase().includes(n) || p.keywords?.includes(n)).slice(0, n ? 5 : 12);
  const d = q.length >= 2 ? res.data : undefined;
  const sections: { title: string; hits: SearchHit[] }[] = d
    ? [
        { title: 'In your library', hits: d.library },
        { title: 'Managed by your apps', hits: d.managed },
        { title: d.canRequest ? 'Request something new' : d.canAdd ? 'Add something new' : 'Not in your library yet (ask an admin for request access)', hits: d.discover },
      ].filter((s) => s.hits.length)
    : [];
  const flat: ({ kind: 'page'; p: PageCmd } | { kind: 'hit'; h: SearchHit })[] = [...pageHits.map((p) => ({ kind: 'page' as const, p })), ...sections.flatMap((s) => s.hits.map((h) => ({ kind: 'hit' as const, h })))];
  useEffect(() => setActive(0), [q]);

  const go = (i: number, fromKeyboard = false) => {
    const row = flat[i];
    if (!row) return;
    // Shift+Enter requests a new title straight away; Enter opens its details.
    if (fromKeyboard && shiftKey.current && row.kind === 'hit' && d && d.discover.includes(row.h) && requestable(row.h) && (d.canRequest || d.canAdd)) {
      setTrigger((t) => ({ key: row.h.key, n: t.n + 1 }));
      return;
    }
    const path = row.kind === 'page' ? row.p.path : row.h.path ?? (row.h.source === 'jellyfin' ? '/jellyfin' : row.h.source === 'seerr' ? '/seerr' : undefined);
    if (path) {
      navigate(path);
      onClose();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(flat.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      shiftKey.current = e.shiftKey;
      go(active, true);
    } else if (e.key === 'Escape') onClose();
  };
  // Braces matter: newer browsers return a Promise from scrollIntoView, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    document.getElementById(`cmd-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let idx = -1;
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[max(10vh,calc(env(safe-area-inset-top)+1rem))] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="glass flex max-h-[75vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              {res.isFetching ? <LoaderCircle className="size-4 shrink-0 animate-spin text-ink-4" /> : <Search className="size-4 shrink-0 text-ink-4" />}
              <input
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="Search movies, shows, music, books and pages…"
                className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
                role="combobox"
                aria-expanded="true"
                aria-controls="cmd-list"
                aria-activedescendant={`cmd-${active}`}
              />
              <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] text-ink-4 sm:block">Esc</kbd>
            </div>
            <PaletteBoundary onReset={() => setText('')}>
            <div id="cmd-list" role="listbox" className="overflow-y-auto p-2">
              {pageHits.length > 0 && (
                <div className="mb-1">
                  <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-ink-4 uppercase">Go to</div>
                  {pageHits.map((p) => {
                    const i = ++idx;
                    const Icon = p.icon;
                    return (
                      <div key={p.key} id={`cmd-${i}`} role="option" aria-selected={active === i} onMouseMove={() => setActive(i)} onClick={() => go(i)} className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-[13px]', active === i ? 'bg-white/[0.07] text-ink' : 'text-ink-2')}>
                        <Icon className="size-4 text-ink-3" /> <span className="flex-1">{p.label}</span>
                        {active === i && <CornerDownLeft className="size-3.5 text-ink-4" />}
                      </div>
                    );
                  })}
                </div>
              )}
              {sections.map((s) => (
                <div key={s.title} className="mb-1">
                  <div className="px-2 pt-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-ink-4 uppercase">{s.title}</div>
                  {s.hits.map((h) => {
                    const i = ++idx;
                    const st = h.status ? STATUS[h.status] : undefined;
                    const svc = h.source === 'plex' || h.source === 'emby' || h.source === 'silo' ? MEDIA_SERVERS[h.source] : SERVICES[h.source as ServiceId];
                    return (
                      <div key={h.key} id={`cmd-${i}`} role="option" aria-selected={active === i} onMouseMove={() => setActive(i)} onClick={() => go(i)} className={cn('flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2', active === i ? 'bg-white/[0.07]' : '')}>
                        <FadeImage src={h.image} alt="" className="h-12 w-8 shrink-0 rounded-md ring-1 ring-white/10" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-ink">
                            {h.title} {h.year ? <span className="font-normal text-ink-4">({h.year})</span> : null}
                          </div>
                          <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-3">
                            {svc && <span className="size-1.5 shrink-0 rounded-full" style={{ background: svc.color }} />}
                            {[svc?.name, h.subtitle].filter(Boolean).join(' · ')}
                          </div>
                          {h.overview && active === i && <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-4">{h.overview}</p>}
                        </div>
                        {st && <Pill tone={st.tone} className="shrink-0">{st.label}</Pill>}
                        {s.hits === d?.discover && <DiscoverActions hit={h} canRequest={d.canRequest} canAdd={d.canAdd} trigger={trigger.key === h.key ? trigger.n : 0} />}
                      </div>
                    );
                  })}
                </div>
              ))}
              {q.length >= 2 && d && !sections.length && !res.isFetching && <p className="px-3 py-8 text-center text-sm text-ink-4">Nothing found for “{q}”.</p>}
              {q.length === 1 && <p className="px-3 py-4 text-center text-xs text-ink-4">Keep typing to search your services…</p>}
              {q.length >= 2 && res.isError && <p role="alert" className="px-3 py-4 text-center text-xs text-bad">Search failed: {(res.error as Error).message}</p>}
              {q.length >= 2 && d?.errors && Object.keys(d.errors).length > 0 && (
                <p className="px-3 pt-2 pb-1 text-[11px] text-warn">
                  Couldn’t search {Object.entries(d.errors).map(([k, v]) => `${k} (${v})`).join(', ')}.
                </p>
              )}
            </div>
            </PaletteBoundary>
            <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-4">
              <span><kbd className="font-sans">↑↓</kbd> to move</span>
              <span><kbd className="font-sans">↵</kbd> to open</span>
              {d?.canRequest && <span className="hidden sm:inline"><kbd className="font-sans">⇧↵</kbd> to request</span>}
              <span className="ml-auto">Searches {main.name}, your *arr apps{d?.canRequest ? (cfgRequests === 'silo' ? ' and Silo requests' : ' and Seerr') : ''}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Opens the palette with ⌘K / Ctrl+K, or "/" outside text fields. */
export function useCommandPaletteHotkey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

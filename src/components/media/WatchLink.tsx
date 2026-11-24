import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Globe, MonitorPlay, Smartphone, X } from 'lucide-react';
import { useServiceConfig } from '@/hooks/queries';
import { cn } from '@/lib/cn';

/*
 * Opening a title in Jellyfin or Moonfin. When an admin switches Moonfin on,
 * the first Play on each device asks where to open it (the Moonfin app, the
 * Moonfin web app or Jellyfin) and can remember the answer for that device.
 */

export type OpenWith = 'moonfin-app' | 'moonfin-web' | 'jellyfin';

const KEY = 'sf:open-with';
const read = (): OpenWith | undefined => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'moonfin-app' || v === 'moonfin-web' || v === 'jellyfin' ? v : undefined;
  } catch {
    return undefined;
  }
};
const write = (v: OpenWith | undefined) => {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: just don't remember */
  }
  window.dispatchEvent(new Event('sf:open-with'));
};

export function useMoonfin() {
  const { data } = useServiceConfig();
  const cfg = data?.moonfin;
  const [saved, setSaved] = useState(read);
  useEffect(() => {
    const on = () => setSaved(read());
    window.addEventListener('sf:open-with', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('sf:open-with', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  // The web app needs a Jellyfin address; without one, only the app works.
  const choice = !cfg ? 'jellyfin' : saved === 'moonfin-web' && !cfg.web ? 'moonfin-app' : saved;
  return {
    enabled: !!cfg,
    web: cfg?.web,
    suggested: (cfg?.openIn === 'app' || !cfg?.web ? 'moonfin-app' : 'moonfin-web') as OpenWith,
    choice,
  };
}

/** Where an item opens for each choice. */
export function itemUrl(target: OpenWith, itemId: string, opts: { jellyfinUrl?: string; web?: string; play?: boolean }) {
  const id = encodeURIComponent(itemId);
  if (target === 'moonfin-app') return `moonfin://${opts.play ? 'play' : 'item'}?id=${id}`;
  if (target === 'moonfin-web') return opts.web ? `${opts.web}#/item/${id}${opts.play ? '?autoPlay=true' : ''}` : undefined;
  return opts.jellyfinUrl;
}

export const targetName = (t: OpenWith | undefined) => (t === 'jellyfin' ? 'Jellyfin' : t ? 'Moonfin' : 'Moonfin');

function go(url: string | undefined) {
  if (!url) return;
  // App links hand off to the installed app; web links open in a new tab.
  if (url.startsWith('moonfin://')) window.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
}

function Chooser({
  open,
  onClose,
  onPick,
  suggested,
  hasWeb,
  hasJellyfin,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (t: OpenWith, remember: boolean) => void;
  suggested: OpenWith;
  hasWeb: boolean;
  hasJellyfin: boolean;
}) {
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  const options: {
    id: OpenWith;
    label: string;
    hint: string;
    icon: typeof Globe;
    show: boolean;
  }[] = [
    {
      id: 'moonfin-app',
      label: 'Moonfin app',
      hint: 'The Moonfin app installed on this device',
      icon: Smartphone,
      show: true,
    },
    {
      id: 'moonfin-web',
      label: 'Moonfin in the browser',
      hint: 'The Moonfin web app on your Jellyfin server',
      icon: Globe,
      show: hasWeb,
    },
    {
      id: 'jellyfin',
      label: 'Jellyfin',
      hint: 'Jellyfin’s own web app',
      icon: MonitorPlay,
      show: hasJellyfin,
    },
  ];
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-with-h"
            className="w-full max-w-sm rounded-2xl border border-line-strong bg-surface-2 p-4 shadow-2xl"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 id="open-with-h" className="flex-1 text-[15px] font-semibold">
                Open in Moonfin?
              </h2>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-white/5 hover:text-ink" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {options
                .filter((o) => o.show)
                .map((o) => (
                  <button
                    key={o.id}
                    autoFocus={o.id === suggested}
                    onClick={() => onPick(o.id, remember)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition hover:bg-white/[0.06]',
                      o.id === suggested ? 'border-brand/50 bg-brand/10' : 'border-line',
                    )}
                  >
                    <o.icon className="size-4 shrink-0 text-ink-2" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{o.label}</span>
                      <span className="block text-[11px] text-ink-4">{o.hint}</span>
                    </span>
                    {o.id === suggested && <span className="text-[10px] text-brand">Suggested</span>}
                  </button>
                ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-ink-3">
              <span className={cn('grid size-4 place-items-center rounded border', remember ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
                {remember && <Check className="size-3" strokeWidth={3} />}
              </span>
              <input type="checkbox" className="sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * A link that opens an item in Jellyfin, or, with Moonfin switched on, in
 * Moonfin (asking the first time). `children` may be a function of the app
 * name, for labels such as "Play in Moonfin".
 */
export function WatchLink({
  itemId,
  jellyfinUrl,
  play,
  className,
  children,
  chooser,
}: {
  itemId: string;
  jellyfinUrl?: string;
  play?: boolean;
  className?: string;
  children: ReactNode | ((app: string) => ReactNode);
  /** Adds a small button to pick the app again. */
  chooser?: boolean;
}) {
  const m = useMoonfin();
  const [asking, setAsking] = useState(false);
  const label = typeof children === 'function' ? children(m.enabled ? targetName(m.choice ?? m.suggested) : 'Jellyfin') : children;
  if (!m.enabled) {
    return jellyfinUrl ? (
      <a href={jellyfinUrl} target="_blank" rel="noreferrer noopener" className={className}>
        {label}
      </a>
    ) : null;
  }
  const open = (t: OpenWith) => go(itemUrl(t, itemId, { jellyfinUrl, web: m.web, play }));
  const main = (
    <button type="button" className={cn(className, chooser && 'flex-1 rounded-r-none')} onClick={() => (m.choice ? open(m.choice) : setAsking(true))}>
      {label}
    </button>
  );
  return (
    <>
      {!chooser ? (
        main
      ) : (
        <span className="inline-flex items-stretch">
          {main}
          <button type="button" onClick={() => setAsking(true)} aria-label="Choose the app to open with" title="Open with…" className={cn(className, 'rounded-l-none border-l border-black/15 px-2')}>
            <ChevronDown className="size-4" />
          </button>
        </span>
      )}
      <Chooser
        open={asking}
        onClose={() => setAsking(false)}
        suggested={m.choice ?? m.suggested}
        hasWeb={!!m.web}
        hasJellyfin={!!jellyfinUrl}
        onPick={(t, remember) => {
          setAsking(false);
          write(remember ? t : undefined);
          open(t);
        }}
      />
    </>
  );
}

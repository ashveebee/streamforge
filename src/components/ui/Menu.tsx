import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface MenuItem {
  label: string;
  icon?: typeof MoreHorizontal;
  danger?: boolean;
  hint?: string;
  onSelect: () => void;
}

/**
 * A small "⋯" menu. Rendered in a portal so cards with overflow-hidden don't
 * clip it; opens upwards when there isn't room below. Closes on outside
 * click, Escape, scroll or selection.
 */
export function Menu({ items, label = 'Actions', busy, trigger, buttonClassName }: { items: MenuItem[]; label?: string; busy?: boolean; trigger?: ReactNode; buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      const t = e.target as Node;
      if (e.type === 'scroll' && list.current?.contains(t)) return;
      if (!ref.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) {
      const right = Math.max(8, window.innerWidth - r.right);
      const below = window.innerHeight - r.bottom;
      setPos(below < 260 && r.top > below ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
    }
    setOpen((v) => !v);
  };
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={toggle}
        className={buttonClassName ?? 'grid size-7 place-items-center rounded-lg text-ink-4 transition hover:bg-white/[0.06] hover:text-ink disabled:opacity-50'}
      >
        {trigger ?? <MoreHorizontal className="size-4" />}
      </button>
      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={list}
            style={pos}
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="fixed z-50 min-w-52 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl shadow-black/50"
          >
            {items.map((it) => (
              <li key={it.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition hover:bg-white/[0.06]',
                    it.danger ? 'text-bad' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {it.icon && <it.icon className="mt-px size-3.5 shrink-0" />}
                  <span>
                    {it.label}
                    {it.hint && <span className="block text-[10.5px] text-ink-4">{it.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </div>
  );
}

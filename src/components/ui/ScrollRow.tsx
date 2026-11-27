import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A row that scrolls sideways (posters, cast). Touch and trackpads swipe as
 * usual; arrow buttons appear at either end while there's more to see, so a
 * mouse can scroll it too.
 */
export function ScrollRow({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // A few pixels of slack: snapping can leave the row just short of either edge.
    setEdges({ start: el.scrollLeft <= 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Images loading in change the content width.
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  const arrow = (dir: 1 | -1) => (
    <button
      type="button"
      onClick={() => page(dir)}
      aria-label={dir === 1 ? `Scroll ${label} right` : `Scroll ${label} left`}
      className={cn(
        'absolute top-[calc(50%-1.25rem)] z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface/90 text-ink shadow-lg shadow-black/40 backdrop-blur transition hover:bg-surface-3',
        dir === 1 ? '-right-2' : '-left-2',
      )}
    >
      {dir === 1 ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
    </button>
  );

  return (
    <div className="relative">
      <div ref={ref} onScroll={measure} role="region" aria-label={label} className={cn('-mx-1 flex snap-x gap-3 overflow-x-auto scroll-smooth px-1 pb-2 no-scrollbar', className)}>
        {children}
      </div>
      {!edges.start && arrow(-1)}
      {!edges.end && arrow(1)}
    </div>
  );
}

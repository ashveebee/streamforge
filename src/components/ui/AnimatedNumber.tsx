import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';
import { getLocale } from '@/i18n';

/** Counts smoothly to the new value whenever it changes. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString(getLocale()), className }: {
  value: number | undefined;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || value === undefined) return;
    if (reduced) {
      el.textContent = format(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (el.textContent = format(v)),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, format, reduced]);

  return (
    <span ref={ref} className={className}>
      {value === undefined ? '—' : format(prev.current)}
    </span>
  );
}

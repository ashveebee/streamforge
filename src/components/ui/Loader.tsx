import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { LogoMark } from '../layout/Logo';

/**
 * Branded loading state: the logo inside a spinning gradient ring with soft
 * pulses behind it. After `slowAfterMs` it says why it's still waiting, so a
 * slow upstream (Jellyfin, usually) never looks like a broken page.
 */
export function Loader({
  label = 'Loading',
  hint,
  slowHint = 'This is taking longer than usual…',
  slowAfterMs = 6000,
  className,
  size = 'md',
}: {
  label?: string;
  hint?: string;
  slowHint?: string;
  slowAfterMs?: number;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowAfterMs);
    return () => clearTimeout(t);
  }, [slowAfterMs]);
  const ring = size === 'sm' ? 64 : 96;
  const logo = size === 'sm' ? 30 : 44;
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className={cn('flex flex-col items-center justify-center gap-5 py-12 text-center', className)}
    >
      <div className="relative grid place-items-center" style={{ width: ring, height: ring }} aria-hidden>
        {/* Soft pulses */}
        <span className="absolute inset-3 rounded-full bg-brand/25 motion-safe:animate-pulse-ring" />
        <span className="absolute inset-3 rounded-full bg-cyan-400/20 motion-safe:animate-pulse-ring [animation-delay:1.2s]" />
        {/* Glow */}
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(closest-side,rgb(167_139_250/0.35),transparent)] blur-md" />
        {/* Spinning gradient ring */}
        <span
          className="absolute inset-0 rounded-full motion-safe:animate-[spin_1.4s_linear_infinite]"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0deg, #c084fc 120deg, #22d3ee 240deg, transparent 360deg)',
            WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))',
          }}
        />
        <span className="absolute inset-0 rounded-full border border-white/[0.06]" />
        <motion.span animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} className="relative">
          <LogoMark size={logo} />
        </motion.span>
      </div>
      <div className="space-y-1">
        <div className="bg-[linear-gradient(90deg,var(--color-ink-3),var(--color-ink),var(--color-ink-3))] bg-[length:200%_100%] bg-clip-text text-sm font-medium text-transparent motion-safe:animate-shimmer">
          {label}
        </div>
        <motion.p key={slow ? 'slow' : 'hint'} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} className="max-w-xs text-xs text-ink-4">
          {slow ? slowHint : hint}
        </motion.p>
      </div>
    </motion.div>
  );
}

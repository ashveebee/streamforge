import { useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Lazy image that fades in once decoded, with a graceful fallback. */
export function FadeImage({
  src,
  alt,
  className,
  imgClassName,
  fallback,
  eager,
}: {
  src?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  fallback?: React.ReactNode;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const show = src && !failed;
  return (
    <div className={cn('relative overflow-hidden bg-surface-3', className)}>
      {!loaded && show && <div className="skeleton absolute inset-0" />}
      {show ? (
        <img
          key={src}
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            'size-full object-cover transition-[opacity,transform] duration-700 ease-out-expo',
            loaded ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0',
            imgClassName,
          )}
        />
      ) : (
        (fallback ?? (
          <div className="grid size-full place-items-center bg-gradient-to-br from-surface-3 to-surface-2 text-ink-4">
            <Clapperboard className="size-1/4 max-h-8 max-w-8" />
          </div>
        ))
      )}
    </div>
  );
}

export function Avatar({ src, name, size = 32, className }: { src?: string; name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  // Deterministic hue per name so avatars stay stable across renders.
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full ring-1 ring-white/10', className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, oklch(0.55 0.14 ${hue}), oklch(0.4 0.12 ${(hue + 40) % 360}))` }}
      title={name}
    >
      {src && !failed ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="font-semibold text-white/90" style={{ fontSize: size * 0.38 }}>
          {initials || '?'}
        </span>
      )}
    </span>
  );
}

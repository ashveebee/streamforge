import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'ghost' | 'outline' | 'subtle';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'icon' }>(
  function Button({ className, variant = 'outline', size = 'md', ...props }, ref) {
    const variants: Record<Variant, string> = {
      primary:
        'bg-gradient-to-b from-violet-400 to-violet-600 text-white shadow-[0_8px_24px_-8px_rgb(139_92_246/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110',
      ghost: 'text-ink-2 hover:bg-white/[0.06] hover:text-ink',
      outline: 'border border-line-strong bg-white/[0.02] text-ink-2 hover:bg-white/[0.06] hover:text-ink',
      subtle: 'bg-white/[0.06] text-ink hover:bg-white/[0.1]',
    };
    const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', icon: 'size-9' };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-xl font-medium whitespace-nowrap transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);

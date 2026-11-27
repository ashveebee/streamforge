import { Languages } from 'lucide-react';
import { LOCALES, useI18n, type Locale } from '@/i18n';
import { cn } from '@/lib/cn';

/** A language menu. Each option is written in its own language so anyone can find theirs. */
export function LanguagePicker({ className, compact }: { className?: string; compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={cn('relative inline-flex items-center', className)}>
      <Languages className="pointer-events-none absolute left-2.5 size-3.5 text-ink-4" aria-hidden />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        aria-label={t('language.choose')}
        title={t('language.description')}
        className={cn(
          'appearance-auto rounded-lg border border-line-strong bg-white/[0.03] pr-2 pl-8 text-ink-2 transition outline-none hover:bg-white/[0.06] focus:border-brand/60 focus:ring-4 focus:ring-brand/10',
          compact ? 'h-8 text-xs' : 'h-10 text-sm',
        )}
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

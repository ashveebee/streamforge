import type { ReactNode } from 'react';
import { motion } from 'motion/react';

export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <motion.header
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-4">
        {icon}
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-xs font-medium tracking-wide text-ink-3">{eyebrow}</div>}
          <h1 className="truncate text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
          {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  );
}

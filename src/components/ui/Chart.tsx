import type { ReactNode } from 'react';
import { getLocale } from '@/i18n';

/* Shared chart styling: recessive grid/axes, ink-coloured text, series colours
 * validated for colour-vision deficiency against the dark surface. */

export const SERIES = {
  sonarr: '#0284c7',
  radarr: '#d97706',
  rx: '#8b5cf6',
  tx: '#0d9488',
  cpu: '#8b5cf6',
  mem: '#0d9488',
  plays: '#8b5cf6',
};

export const axisProps = {
  stroke: 'transparent',
  tick: { fill: 'var(--color-ink-4)', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: 'rgb(255 255 255 / 0.05)',
  vertical: false,
  strokeDasharray: '0',
} as const;

export function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.4} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

interface TooltipEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue,
  formatLabel,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatValue?: (v: number, key?: string) => string;
  formatLabel?: (l: string | number) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass min-w-36 rounded-xl px-3 py-2.5 text-xs shadow-2xl">
      {label !== undefined && <div className="mb-1.5 text-ink-3">{formatLabel ? formatLabel(label) : label}</div>}
      <div className="space-y-1">
        {payload.map((p) => (
          <div key={String(p.dataKey)} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            <span className="flex-1 text-ink-2">{p.name}</span>
            <span className="font-medium text-ink tabular">
              {formatValue ? formatValue(Number(p.value), String(p.dataKey)) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-xs text-ink-3">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
          {i.label}
          {i.value !== undefined && <span className="font-medium text-ink-2 tabular">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

export const timeLabel = (t: string | number) =>
  new Date(Number(t)).toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit', second: '2-digit' });

import { useId } from 'react';

/**
 * Minimal latency sparkline. `null` points are failed checks and are drawn as
 * gaps with a red tick at the baseline, so failures are visible at a glance.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = '#a78bfa',
  className,
}: {
  data: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  const id = useId();
  const values = data.filter((v): v is number => v !== null);
  if (data.length < 2 || !values.length) {
    return <svg width={width} height={height} className={className} aria-hidden />;
  }
  const max = Math.max(...values) * 1.15 || 1;
  const step = width / (data.length - 1);
  const y = (v: number) => height - 2 - (v / max) * (height - 4);

  const segments: string[] = [];
  let current = '';
  data.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const firstIdx = data.findIndex((v) => v !== null);
  const lastIdx = data.length - 1 - [...data].reverse().findIndex((v) => v !== null);
  const area = `${segments.join('')}L${(lastIdx * step).toFixed(1)},${height}L${(firstIdx * step).toFixed(1)},${height}Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {segments.length === 1 && <path d={area} fill={`url(#${id})`} />}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {data.map((v, i) =>
        v === null ? <rect key={i} x={i * step - 1} y={height - 4} width={2} height={4} rx={1} fill="var(--color-bad)" /> : null,
      )}
    </svg>
  );
}

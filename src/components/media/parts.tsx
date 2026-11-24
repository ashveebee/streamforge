import { useState } from 'react';
import { AudioLines, Captions, FileVideo } from 'lucide-react';
import { bitrate, bytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Episode, MediaFile } from '@/hooks/useMedia';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

/* Small pieces shared by the title page and its episode details. */

export const episodeLabel = (e: Pick<Episode, 'season' | 'number'>) => [e.season !== undefined && `S${e.season}`, e.number !== undefined && `E${e.number}`].filter(Boolean).join(' ');
export const bits = (bps?: number) => (bps ? bitrate(bps / 8) : undefined);
export const longDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : undefined);
export const langName = (code?: string) => {
  if (!code || code === 'und') return undefined;
  try {
    return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === undefined || children === null || children === false || children === '') return null;
  return (
    <div className="flex items-baseline gap-3 py-2">
      <dt className="w-24 shrink-0 text-[11px] tracking-wide text-ink-4 uppercase">{label}</dt>
      <dd className="min-w-0 flex-1 text-[13px] break-words text-ink-2">{children}</dd>
    </div>
  );
}

export function Chip({ children, tone }: { children: React.ReactNode; tone?: 'brand' }) {
  return <span className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tone === 'brand' ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line bg-white/[0.04] text-ink-2')}>{children}</span>;
}

export function Track({ title, sub, flags }: { title: string; sub?: string; flags: string[] }) {
  return (
    <li className="flex items-center gap-2 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-ink-2" title={title}>{title}</div>
        {sub && <div className="truncate text-[11px] text-ink-4">{sub}</div>}
      </div>
      {flags.map((f) => (
        <span key={f} className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-3">{f}</span>
      ))}
    </li>
  );
}

/** The file(s) Jellyfin plays: video, audio and subtitle tracks. */
export function MediaInfo({ files }: { files: MediaFile[] }) {
  const [open, setOpen] = useState(0);
  if (!files.length) return null;
  const f = files[Math.min(open, files.length - 1)]!;
  const v = f.video;
  return (
    <Card>
      <CardHeader icon={FileVideo} accent="var(--color-jellyfin)" title="Media info" subtitle={files.length > 1 ? `${files.length} versions` : f.container?.toUpperCase()} />
      <CardBody className="space-y-4">
        {files.length > 1 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 no-scrollbar">
            {files.map((x, i) => (
              <button
                key={x.id}
                onClick={() => setOpen(i)}
                className={cn('shrink-0 rounded-lg border px-2.5 py-1 text-[12px] transition', i === open ? 'border-brand/50 bg-brand/10 text-ink' : 'border-line text-ink-3 hover:text-ink')}
              >
                {x.name || x.video?.resolution || `Version ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {v?.resolution && <Chip tone="brand">{v.resolution}</Chip>}
          {v?.range && <Chip tone="brand">{v.range}</Chip>}
          {v?.codec && <Chip>{v.codec}</Chip>}
          {v?.bitDepth && v.bitDepth > 8 ? <Chip>{v.bitDepth}-bit</Chip> : null}
          {f.audio[0]?.codec && <Chip>{[f.audio[0].codec, f.audio[0].channels].filter(Boolean).join(' ')}</Chip>}
          {f.container && <Chip>{f.container.toUpperCase()}</Chip>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {[
            ['Size', f.size ? bytes(f.size) : undefined],
            ['Bitrate', bits(f.bitrate)],
            ['Resolution', v?.width && v.height ? `${v.width}×${v.height}` : undefined],
            ['Frame rate', v?.fps ? `${v.fps} fps` : undefined],
          ]
            .filter(([, x]) => x)
            .map(([k, x]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[10.5px] tracking-wide text-ink-4 uppercase">{k}</dt>
                <dd className="truncate text-[13px] text-ink-2 tabular-nums">{x}</dd>
              </div>
            ))}
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><AudioLines className="size-3.5" /> Audio · {f.audio.length}</h3>
            {f.audio.length ? (
              <ul className="divide-y divide-line">
                {f.audio.map((a, i) => (
                  <Track key={i} title={langName(a.language) ?? a.title ?? `Track ${i + 1}`} sub={[a.codec, a.channels].filter(Boolean).join(' · ') || a.title} flags={a.isDefault ? ['Default'] : []} />
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-4">No audio tracks</p>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-3"><Captions className="size-3.5" /> Subtitles · {f.subtitles.length}</h3>
            {f.subtitles.length ? (
              <ul className="max-h-60 divide-y divide-line overflow-y-auto">
                {f.subtitles.map((t, i) => (
                  <Track
                    key={i}
                    title={langName(t.language) ?? t.title ?? `Track ${i + 1}`}
                    sub={t.codec}
                    flags={[t.forced && 'Forced', t.sdh && 'SDH', t.external && 'External', t.isDefault && 'Default'].filter((x): x is string => !!x)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-4">No subtitles</p>
            )}
          </div>
        </div>
        {f.path && <p className="truncate font-mono text-[10.5px] text-ink-4" title={f.path}>{f.path}</p>}
      </CardBody>
    </Card>
  );
}


import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, CircleCheck, Copy, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCheckUpdates, useUpdates, type Release } from '@/hooks/useUpdates';
import { dayLabel, relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';

const COMMANDS = [
  { label: 'Docker Compose', cmd: 'docker compose pull && docker compose up -d' },
  { label: 'docker run', cmd: 'docker pull ghcr.io/ashveebee/streamforge:latest' },
];

/** Settings: the running version, and what's new when a release is out. */
export function UpdatesSection() {
  const q = useUpdates();
  const check = useCheckUpdates();
  const ref = useRef<HTMLElement>(null);
  // Links to /settings#updates (sidebar, notifications) land here.
  useEffect(() => {
    if (q.data && location.hash === '#updates') ref.current?.scrollIntoView({ block: 'start' });
  }, [q.data]);
  const d = q.data;
  if (!d) return null;

  return (
    <section ref={ref} id="updates" className="mb-8 scroll-mt-6" aria-labelledby="updates-h">
      <h2 id="updates-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <ArrowUpCircle className="size-4 text-brand" /> Updates
      </h2>
      <p className="mb-3 text-xs text-ink-3">
        {d.enabled
          ? 'StreamForge checks GitHub for new releases every 6 hours. Only the version number is sent.'
          : 'Update checks are off (UPDATE_CHECK=false).'}
      </p>
      <Card>
        <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {d.available ? <ArrowUpCircle className="mt-0.5 size-5 shrink-0 text-brand" /> : <CircleCheck className="mt-0.5 size-5 shrink-0 text-ok" />}
            <div>
              <div className="text-[14px] font-semibold text-ink">
                {d.available ? `StreamForge ${d.available} is available` : d.enabled && d.checkedAt && !d.error ? 'You’re on the latest version' : `StreamForge ${d.current}`}
              </div>
              <div className="mt-0.5 text-xs text-ink-3">
                You’re running {d.current}
                {d.available && d.releases.length > 1 ? ` · ${d.releases.length} releases behind` : ''}
                {d.checkedAt ? ` · checked ${relative(d.checkedAt)}` : d.enabled ? ' · first check runs a minute after start-up' : ''}
              </div>
              {d.error && <div className="mt-1 text-xs text-warn">{d.error}</div>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {d.enabled && (
              <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={check.isPending}>
                {check.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Check now
              </Button>
            )}
            <a href={d.available ? d.releases[0]!.url : d.repoUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" tabIndex={-1}>
                <ExternalLink className="size-3.5" /> Releases
              </Button>
            </a>
          </div>
        </div>

        {d.available && (
          <>
            <div className="border-t border-line px-5 py-4">
              <h3 className="mb-2 text-xs font-medium text-ink-2">How to update</h3>
              <div className="space-y-2">
                {COMMANDS.map((c) => <Command key={c.label} {...c} />)}
              </div>
              <p className="mt-2 text-[11.5px] text-ink-4">
                With <code className="text-ink-3">docker run</code>, remove and start the container again after pulling. If you pinned a version tag, change it to {d.available} first. Settings live in the data volume and carry over.
              </p>
            </div>
            <div className="border-t border-line px-5 py-4">
              <h3 className="mb-3 text-xs font-medium text-ink-2">What’s new since {d.current}</h3>
              <div className="space-y-5">
                {d.releases.map((r) => <ReleaseNotes key={r.version} r={r} />)}
              </div>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

function Command({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[7rem_1fr_auto]">
      <span className="col-span-2 text-[11.5px] text-ink-4 sm:col-span-1">{label}</span>
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-white/[0.03] px-2.5 py-1.5 font-mono text-[12px] whitespace-nowrap text-ink-2">{cmd}</code>
      <button
        type="button"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-4 transition hover:bg-white/[0.06] hover:text-ink-2"
        aria-label={`Copy the ${label} command`}
        onClick={() => {
          void navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <CircleCheck className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}

function ReleaseNotes({ r }: { r: Release }) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <a href={r.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold text-ink hover:underline">
          {r.version}
        </a>
        <span className="text-[11.5px] text-ink-4">{dayLabel(r.publishedAt)}</span>
      </div>
      {r.notes.length ? (
        r.notes.map((n) => (
          <div key={n.heading} className="mb-2">
            <Pill className="mb-1" tone={/fix/i.test(n.heading) ? 'neutral' : 'brand'}>{n.heading}</Pill>
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">
              {n.items.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </div>
        ))
      ) : (
        <p className="text-[12.5px] text-ink-3">No notes for this release.</p>
      )}
    </div>
  );
}

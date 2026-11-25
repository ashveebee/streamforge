import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Images, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { useKometaStatus } from '@/components/widgets/KometaCard';

interface KometaSettings {
  enabled: boolean;
  /** The webhook path, including its secret token. */
  path: string;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? 'Copied' : label}
    </Button>
  );
}

/** Kometa sends webhooks to StreamForge; this shows the address to put in its config. */
export function KometaSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'kometa'], queryFn: () => api<KometaSettings>('/settings/kometa') });
  const status = useKometaStatus(!!q.data?.enabled);
  const save = useMutation({
    mutationFn: (b: { enabled?: boolean; regenerate?: boolean }) => api<KometaSettings>('/settings/kometa', { method: 'PUT', body: b }),
    onSuccess: (d) => {
      qc.setQueryData(['settings', 'kometa'], d);
      void qc.invalidateQueries({ queryKey: ['kometa'] });
    },
  });
  const d = q.data;
  if (!d) return null;
  const url = `${window.location.origin}${d.path}`;
  const yaml = ['webhooks:', ...['error', 'run_start', 'run_end', 'version', 'changes', 'delete'].map((k) => `  ${k}: ${url}`)].join('\n');
  const heard = status.data?.runs[0]?.at ?? status.data?.errors[0]?.at;

  return (
    <section className="mt-8" aria-labelledby="kometa-h">
      <h2 id="kometa-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Images className="size-4 text-[#f59e0b]" /> Kometa
      </h2>
      <p className="mb-3 text-xs text-ink-3">
        Kometa builds collections, overlays and playlists on a schedule. Point its webhooks at StreamForge to see each run, its errors and what changed on System Status, and get
        alerts when a run fails.
      </p>
      <Card>
        <div className="divide-y divide-line">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">Receive Kometa webhooks</div>
              <div className="text-[11px] text-ink-4">
                {!d.enabled
                  ? 'Off: StreamForge ignores anything sent to the address.'
                  : status.data?.waiting
                    ? 'Waiting for Kometa’s first message.'
                    : heard
                      ? `Last heard from Kometa ${relative(heard)}.`
                      : 'On.'}
              </div>
            </div>
            <Switch checked={d.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ enabled: v })} label="Receive Kometa webhooks" />
          </div>
          {d.enabled && (
            <div className="space-y-3 px-5 py-4">
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-ink-2">1. Add this to Kometa’s <code className="font-mono">config.yml</code></div>
                <pre className="overflow-x-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{yaml}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={yaml} label="Copy config" />
                  <CopyButton text={url} label="Copy address" />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-4">
                2. The address must be reachable from where Kometa runs. If Kometa is in Docker, swap the start of it for StreamForge’s LAN address or container name, such as{' '}
                <code className="font-mono">http://streamforge:4000</code>. Keep the rest: the long code at the end is what lets Kometa in, so keep it private. Already have
                webhooks set up for Discord or Notifiarr? Make each entry a list and add this address to it.
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="mr-auto text-[11px] text-ink-4">Shared the address by mistake? Make a new one; the old one stops working.</span>
                <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => confirm('Make a new webhook address? Kometa will need the new one.') && save.mutate({ regenerate: true })}>
                  <RefreshCw className="size-3.5" /> New address
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

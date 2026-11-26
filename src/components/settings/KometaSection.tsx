import { cn } from '@/lib/cn';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Images, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { relative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { useKometaStatus } from '@/components/widgets/KometaCard';
import { useCollections, type CollectionSettings } from '@/hooks/useKometa';

interface KometaSettings {
  enabled: boolean;
  /** The webhook path, including its secret token. */
  path: string;
  collections: CollectionSettings;
}

const field =
  'h-9 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 outline-none transition focus:border-brand/60 focus:ring-4 focus:ring-brand/10';

/** Where Kometa's config is mounted, when it runs, and the lines that load StreamForge's files. */
function CollectionsSetup({ s, onSave, saving }: { s: CollectionSettings; onSave: (b: { configDir?: string; runTimes?: string[]; tmdbKey?: string }) => void; saving: boolean }) {
  const [dir, setDir] = useState(s.configDir);
  const [times, setTimes] = useState(s.runTimes.join(', '));
  const [key, setKey] = useState('');
  const cols = useCollections();
  const libs = s.folder.ok ? (cols.data?.libraries ?? []) : [];
  const yaml = libs.length
    ? ['libraries:', ...libs.flatMap((l) => [`  ${l.name}:   # ${l.serverName}`, '    collection_files:', `      - file: ${l.kometaFile}`])].join('\n')
    : '';
  const dirty = dir !== s.configDir || times !== s.runTimes.join(', ') || !!key;
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="text-[13px] font-medium">Collections from StreamForge</div>
      <p className="text-[11px] leading-relaxed text-ink-4">
        Mount Kometa’s config folder into StreamForge read-write (for example <code className="font-mono">- /opt/kometa/config:/kometa</code>). StreamForge only writes its own files, in a{' '}
        <code className="font-mono">streamforge</code> folder inside it.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">Kometa config folder</span>
          <input className={field} value={dir} placeholder="/kometa" spellCheck={false} onChange={(e) => setDir(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">Kometa runs at</span>
          <input className={field} value={times} placeholder="05:00" spellCheck={false} onChange={(e) => setTimes(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">TMDb API key</span>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            value={key}
            placeholder={s.tmdbKeySet ? 'Saved — blank keeps it' : s.tmdbKeyFromKometa ? 'Using Kometa’s key' : 'Optional'}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`mr-auto text-[11px] ${s.configDir && !s.folder.ok ? 'text-warn' : 'text-ink-4'}`}>
          {!s.configDir
            ? 'Run times are Kometa’s KOMETA_TIMES; they’re used to say when new collections will appear.'
            : s.folder.ok
              ? `Folder found${s.folder.hasConfig ? ', with Kometa’s config.yml' : ' (no config.yml in it — is it the right folder?)'}.${s.tmdbKeyFromKometa ? ' TMDb key read from config.yml.' : ''}`
              : s.folder.message}
        </span>
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => onSave({ configDir: dir, runTimes: times.split(/[\s,]+/).filter(Boolean), ...(key ? { tmdbKey: key } : {}) })}>
          Save
        </Button>
      </div>
      {yaml && (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">Then load StreamForge’s files in Kometa’s config.yml</div>
          <pre className="overflow-x-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{yaml}</pre>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
            Add the <code className="font-mono">- file:</code> line to each library’s existing <code className="font-mono">collection_files</code>. Library names must match Kometa’s. Jellyfin and Emby
            libraries need Kometa’s develop build for now.
          </p>
          <div className="mt-2"><CopyButton text={yaml} label="Copy" /></div>
        </div>
      )}
    </div>
  );
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
/** `grouped`: shown inside a Settings group, so a smaller heading. */
export function KometaSection({ grouped = false }: { grouped?: boolean } = {}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'kometa'], queryFn: () => api<KometaSettings>('/settings/kometa') });
  const status = useKometaStatus(!!q.data?.enabled);
  const save = useMutation({
    mutationFn: (b: { enabled?: boolean; regenerate?: boolean; configDir?: string; runTimes?: string[]; tmdbKey?: string }) =>
      api<KometaSettings>('/settings/kometa', { method: 'PUT', body: b }),
    onSuccess: (d) => {
      qc.setQueryData(['settings', 'kometa'], d);
      void qc.invalidateQueries({ queryKey: ['kometa'] });
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
  const d = q.data;
  if (!d) return null;
  const url = `${window.location.origin}${d.path}`;
  const yaml = ['webhooks:', ...['error', 'run_start', 'run_end', 'version', 'changes', 'delete'].map((k) => `  ${k}: ${url}`)].join('\n');
  const heard = status.data?.runs[0]?.at ?? status.data?.errors[0]?.at;

  return (
    <section className={grouped ? 'pt-1' : 'mt-8'} aria-labelledby="kometa-h">
      <h2 id="kometa-h" className={cn('mb-1 flex items-center gap-2 font-semibold tracking-tight', grouped ? 'px-1 text-[14px]' : 'text-lg')}>
        <Images className="size-4 text-[#f59e0b]" /> Kometa
      </h2>
      <p className={cn('mb-3 text-xs text-ink-3', grouped && 'px-1')}>
        Kometa builds collections, overlays and playlists on a schedule. Point its webhooks at StreamForge to see each run, its errors and what changed, and get alerts when a
        run fails. Connect its config folder to make collections from StreamForge.
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
          <CollectionsSetup s={d.collections} saving={save.isPending} onSave={(b) => save.mutate(b)} />
        </div>
      </Card>
    </section>
  );
}

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
import { t } from '@/i18n';

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
      <div className="text-[13px] font-medium">{t('sec.kometa.collections')}</div>
      <p className="text-[11px] leading-relaxed text-ink-4">
        {t('sec.kometa.mount')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">{t('sec.kometa.folder')}</span>
          <input className={field} value={dir} placeholder="/kometa" spellCheck={false} onChange={(e) => setDir(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">{t('sec.kometa.runsAt')}</span>
          <input className={field} value={times} placeholder="05:00" spellCheck={false} onChange={(e) => setTimes(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-3">{t('sec.kometa.tmdb')}</span>
          <input
            className={field}
            type="password"
            autoComplete="new-password"
            value={key}
            placeholder={s.tmdbKeySet ? t('sec.savedBlank') : s.tmdbKeyFromKometa ? t('sec.kometa.usingKometa') : t('common.optional')}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`mr-auto text-[11px] ${s.configDir && !s.folder.ok ? 'text-warn' : 'text-ink-4'}`}>
          {!s.configDir
            ? t('sec.kometa.runTimes')
            : s.folder.ok
              ? `${s.folder.hasConfig ? t('sec.kometa.foundConfig') : t('sec.kometa.foundNoConfig')}${s.tmdbKeyFromKometa ? ` ${t('sec.kometa.keyRead')}` : ''}`
              : s.folder.message}
        </span>
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => onSave({ configDir: dir, runTimes: times.split(/[\s,]+/).filter(Boolean), ...(key ? { tmdbKey: key } : {}) })}>
          {t('common.save')}
        </Button>
      </div>
      {yaml && (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">{t('sec.kometa.thenLoad')}</div>
          <pre className="overflow-x-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{yaml}</pre>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
            {t('sec.kometa.addLine')}
          </p>
          <div className="mt-2"><CopyButton text={yaml} label={t('sec.mfa.copy')} /></div>
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
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {done ? t('sec.kometa.copied') : label}
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
        {t('sec.kometa.intro')}
      </p>
      <Card>
        <div className="divide-y divide-line">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t('sec.kometa.receive')}</div>
              <div className="text-[11px] text-ink-4">
                {!d.enabled
                  ? t('sec.kometa.off')
                  : status.data?.waiting
                    ? t('sec.kometa.waiting')
                    : heard
                      ? t('sec.kometa.heard', { when: relative(heard) })
                      : `${t('widgets.cleanup.on')}.`}
              </div>
            </div>
            <Switch checked={d.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ enabled: v })} label={t('sec.kometa.receive')} />
          </div>
          {d.enabled && (
            <div className="space-y-3 px-5 py-4">
              <div>
                <div className="mb-1.5 text-[12px] font-medium text-ink-2">{t('sec.kometa.step1')}</div>
                <pre className="overflow-x-auto rounded-xl border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{yaml}</pre>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={yaml} label={t('sec.kometa.copyConfig')} />
                  <CopyButton text={url} label={t('sec.kometa.copyAddress')} />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-4">
                {t('sec.kometa.step2')}
              </p>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="mr-auto text-[11px] text-ink-4">{t('sec.kometa.shared')}</span>
                <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => confirm(t('sec.kometa.confirmNew')) && save.mutate({ regenerate: true })}>
                  <RefreshCw className="size-3.5" /> {t('sec.kometa.newAddress')}
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

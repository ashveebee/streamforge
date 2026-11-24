import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleHelp, ExternalLink, Globe, Moon, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';

interface MoonfinSettings {
  enabled: boolean;
  openIn: 'web' | 'app';
  webUrl?: string;
  status?: { installed: boolean; version?: string; error?: string };
}

/** Offer to open titles in Moonfin, a Jellyfin client, instead of Jellyfin's web app. */
export function MoonfinSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'moonfin'], queryFn: () => api<MoonfinSettings>('/settings/moonfin') });
  const save = useMutation({
    mutationFn: (b: Partial<Pick<MoonfinSettings, 'enabled' | 'openIn'>>) => api<MoonfinSettings>('/settings/moonfin', { method: 'PUT', body: b }),
    onSuccess: (d) => {
      qc.setQueryData<MoonfinSettings>(['settings', 'moonfin'], (old) => ({ ...old, ...d }));
      // The play buttons read Moonfin from /config.
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
  const d = q.data;
  if (!d) return null;
  const st = d.status;
  return (
    <section className="mt-8" aria-labelledby="moonfin-h">
      <h2 id="moonfin-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Moon className="size-4 text-brand" /> Moonfin
      </h2>
      <p className="mb-3 text-xs text-ink-3">
        Moonfin is a Jellyfin app for phones, TVs, desktops and the web. Switch it on and Play buttons offer to open titles in Moonfin. Each device asks once and can remember the answer.
      </p>
      <Card>
        <div className="divide-y divide-line">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">Open titles in Moonfin</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
                {st?.installed ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <CircleCheck className="size-3" /> Moonfin plugin found on your Jellyfin server{st.version ? ` · v${st.version}` : ''}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <CircleHelp className="size-3" /> Moonfin plugin not found on Jellyfin. The Moonfin apps still work; the web app needs the plugin.
                  </span>
                )}
              </div>
            </div>
            <Switch checked={d.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ enabled: v })} label="Open titles in Moonfin" />
          </div>
          <div className={cn('px-5 py-4', !d.enabled && 'opacity-50')}>
            <div className="mb-2 text-xs font-medium text-ink-2">Suggest opening in</div>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Suggest opening in">
              {(
                [
                  ['web', Globe, 'Moonfin in the browser', d.webUrl ?? 'Set Jellyfin’s public address first'],
                  ['app', Smartphone, 'The Moonfin app', 'Opens moonfin:// links in the installed app'],
                ] as const
              ).map(([id, Icon, label, hint]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={d.openIn === id}
                  disabled={!d.enabled || save.isPending}
                  onClick={() => save.mutate({ openIn: id })}
                  className={cn('flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition', d.openIn === id ? 'border-brand/50 bg-brand/10' : 'border-line hover:bg-white/[0.03]')}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-ink-2" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="block truncate text-[11px] text-ink-4">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-4">
              People can still choose another app, or Jellyfin, from the arrow next to Play.{' '}
              <a href="https://github.com/Moonfin-Client" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                About Moonfin <ExternalLink className="size-3" />
              </a>
            </p>
            {save.error && <p className="mt-2 text-xs text-bad">{(save.error as Error).message}</p>}
          </div>
        </div>
      </Card>
    </section>
  );
}

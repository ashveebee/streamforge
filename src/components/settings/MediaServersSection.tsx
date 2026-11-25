import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, KeyRound, LoaderCircle, PlugZap, Plus, Radar, Save, Trash2 } from 'lucide-react';
import {
  useDiscoverMediaServers,
  useMediaServerSettings,
  useRemoveMediaServer,
  useSaveMediaServer,
  useTestMediaServer,
} from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { DiscoveredServer, MediaServerType, MediaServerView } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Status';
import { Switch } from '@/components/ui/Switch';
import { ServiceIcon } from '@/components/ui/ServiceIcon';

const inputCls =
  'h-9 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 transition outline-none focus:border-brand/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand/10 aria-[invalid=true]:border-bad/60';

type Draft = { type: MediaServerType; name: string; url: string };

export const SERVER_TYPE_NAMES: Record<MediaServerType, string> = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex' };

/** Per-type wording: default port, key name and where to find it. */
const TYPE_HELP: Record<MediaServerType, { placeholder: string; key: string; hint: string }> = {
  jellyfin: { placeholder: 'http://192.168.1.20:8096', key: 'API key', hint: 'Create an API key in Jellyfin under Dashboard → API Keys.' },
  emby: { placeholder: 'http://192.168.1.20:8096', key: 'API key', hint: 'Create an API key in Emby under Settings → Advanced → API Keys.' },
  plex: {
    placeholder: 'http://192.168.1.20:32400',
    key: 'Plex token',
    hint: 'Use the server owner’s Plex token (Plex’s “Finding an authentication token” help article shows how). Plex streams can be stopped, not paused or messaged.',
  },
};

function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function ServerRow({ srv, draft, onDone }: { srv?: MediaServerView; draft?: Draft; onDone?: () => void }) {
  const blank = { name: srv?.name ?? draft?.name ?? '', url: srv?.url ?? draft?.url ?? '', publicUrl: srv?.publicUrl ?? '', apiKey: '' };
  const [form, setForm] = useState(blank);
  const type: MediaServerType = srv?.type ?? draft?.type ?? 'jellyfin';
  const help = TYPE_HELP[type];
  const test = useTestMediaServer();
  const save = useSaveMediaServer();
  const remove = useRemoveMediaServer();
  useEffect(
    () => setForm({ name: srv?.name ?? draft?.name ?? '', url: srv?.url ?? draft?.url ?? '', publicUrl: srv?.publicUrl ?? '', apiKey: '' }),
    [srv?.name, srv?.url, srv?.publicUrl, draft?.name, draft?.url],
  );

  const dirty = !srv || form.name !== blank.name || form.url !== blank.url || form.publicUrl !== blank.publicUrl || !!form.apiKey;
  const err = save.error instanceof ApiError ? save.error : undefined;
  const busy = test.isPending || save.isPending || remove.isPending;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    test.reset();
    save.reset();
  };
  const input = () => ({
    id: srv?.id,
    type: srv ? undefined : type,
    name: form.name.trim(),
    url: form.url.trim(),
    publicUrl: form.publicUrl.trim(),
    apiKey: form.apiKey.trim() || undefined,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(input()).catch(() => undefined);
    if (r && !srv) onDone?.();
    if (r) setForm((f) => ({ ...f, apiKey: '' }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-3 px-5 py-4', srv && !srv.enabled && 'opacity-70')}>
      <div className="grid gap-3 md:grid-cols-[minmax(120px,0.7fr)_minmax(180px,1.3fr)_minmax(180px,1fr)]">
        <input
          aria-label="Server name"
          className={inputCls}
          placeholder="Name, e.g. Cabin"
          value={form.name}
          aria-invalid={err?.field === 'name'}
          onChange={(e) => set('name', e.target.value)}
        />
        <input
          aria-label="Server address"
          className={inputCls}
          type="url"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder={help.placeholder}
          value={form.url}
          aria-invalid={err?.field === 'url'}
          onChange={(e) => set('url', e.target.value)}
        />
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
          <input
            aria-label={help.key}
            className={cn(inputCls, 'pl-8 font-mono text-[13px]')}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={srv?.apiKeySet ? `Saved ${srv.apiKeyHint ?? '••••'} — blank keeps it` : help.key}
            value={form.apiKey}
            aria-invalid={err?.field === 'apiKey'}
            onChange={(e) => set('apiKey', e.target.value)}
          />
        </div>
      </div>
      <input
        aria-label="Public address (optional)"
        className={inputCls}
        type="url"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        placeholder="Public address, if you open it at a different one (optional)"
        value={form.publicUrl}
        aria-invalid={err?.field === 'publicUrl'}
        onChange={(e) => set('publicUrl', e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0 text-xs">
          {err ? (
            <span className="text-bad" role="alert">{err.message}</span>
          ) : test.data ? (
            test.data.ok ? (
              <span className="inline-flex items-center gap-1 text-ok"><CircleCheck className="size-3.5" /> Connected{test.data.version ? ` · v${test.data.version}` : ''}</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-bad"><CircleX className="size-3.5" /> {test.data.message}</span>
            )
          ) : srv ? (
            <span className="text-ink-4">{srv.enabled ? 'Monitoring' : 'Switched off'}</span>
          ) : (
            <span className="text-ink-4">{help.hint}</span>
          )}
        </div>
        {srv && (
          <>
            <Switch
              checked={srv.enabled}
              disabled={busy}
              onChange={(v) => save.mutate({ id: srv.id, enabled: v })}
              label={srv.enabled ? `Stop monitoring ${srv.name}` : `Monitor ${srv.name}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm(`Stop monitoring the ${SERVER_TYPE_NAMES[srv.type]} server "${srv.name}" and remove it?`)) remove.mutate(srv.id);
              }}
            >
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </>
        )}
        {!srv && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" disabled={busy || !form.url.trim()} onClick={() => test.mutate(input())}>
          {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          Test
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty}>
          {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {srv ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

const DISCOVERY_HINT: Record<MediaServerType, string> = {
  jellyfin: 'Jellyfin needs “Enable auto discovery” on (Dashboard → Networking).',
  emby: 'Emby answers on UDP port 7359; check that a firewall isn’t blocking it.',
  plex: 'Plex needs “Enable local network discovery (GDM)” on (Settings → Network).',
};

/** What a network search found, with a way to add each server. */
function DiscoveryResults({ type, servers, onAdd, pending }: { type: MediaServerType; servers: DiscoveredServer[]; onAdd: (d: Draft) => void; pending: Set<string> }) {
  if (!servers.length) {
    return (
      <div className="px-5 py-4 text-xs leading-relaxed text-ink-3">
        <p className="font-medium text-ink-2">No {SERVER_TYPE_NAMES[type]} servers answered.</p>
        <p className="mt-1">
          Discovery only reaches servers on the same local network. {DISCOVERY_HINT[type]} If StreamForge runs in Docker, the container needs host networking (
          <code className="font-mono">network_mode: host</code>) for the search to leave it. You can still add a server by its address.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {servers.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              {s.name}
              {s.version && <span className="text-[11px] font-normal text-ink-4">v{s.version}</span>}
            </div>
            <div className="truncate font-mono text-[11px] text-ink-3">{s.url}</div>
            {!s.reachable && <div className="text-[11px] text-warn">Answered the search but not over HTTP. Check the address before adding it.</div>}
          </div>
          {s.added ? (
            <Pill>Already added</Pill>
          ) : pending.has(s.url) ? (
            <Pill tone="brand">{s.type === 'plex' ? 'Needs token' : 'Needs API key'}</Pill>
          ) : (
            <Button size="sm" onClick={() => onAdd({ type, name: s.name, url: s.url })}>
              <Plus className="size-3.5" /> Add
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

const INTRO: Record<MediaServerType, string> = {
  jellyfin: 'Monitor other Jellyfin servers: health, outage alerts, their streams on Now Playing and a tab each on the Jellyfin page. Sign-in still uses the main server.',
  emby: 'Monitor Emby servers: health, outage alerts, their streams on Now Playing and an Emby page with a tab per server.',
  plex: 'Monitor Plex servers: health, outage alerts, their streams on Now Playing and a Plex page with a tab per server.',
};

/**
 * Media servers of one kind. Extra Jellyfin servers sit under the main
 * Jellyfin card; Emby and Plex get cards of their own.
 */
export function MediaServersSection({ type }: { type: MediaServerType }) {
  const q = useMediaServerSettings();
  const discover = useDiscoverMediaServers();
  const name = SERVER_TYPE_NAMES[type];
  // Unsaved rows: a blank one from "Add server", or ones prefilled from discovery.
  const [drafts, setDrafts] = useState<(Draft & { key: number })[]>([]);
  const list = (q.data?.servers ?? []).filter((s) => s.type === type);
  const all = q.data?.servers ?? [];
  const addDraft = (d: Draft) => setDrafts((all) => (all.some((x) => x.url && x.url === d.url) ? all : [...all, { ...d, key: Date.now() + all.length }]));
  const dropDraft = (key: number) => setDrafts((all) => all.filter((d) => d.key !== key));
  // Servers saved since the search count as added too.
  const savedOrigins = new Set(all.map((s) => originOf(s.url)));
  const found = discover.data?.servers.filter((s) => s.type === type).map((s) => ({ ...s, added: s.added || savedOrigins.has(originOf(s.url)) }));

  return (
    <li>
      <Card>
        <header className={cn('flex flex-wrap items-center gap-3', type === 'jellyfin' ? 'px-5 py-3' : 'p-5')}>
          {type !== 'jellyfin' && <ServiceIcon id={type} size={40} />}
          <div className="min-w-[12rem] flex-1">
            <h3 className={type === 'jellyfin' ? 'text-[13px] font-semibold' : 'text-[15px] font-semibold'}>
              {type === 'jellyfin' ? 'More Jellyfin servers' : name}
              {type !== 'jellyfin' && list.length > 0 && (
                <span className="ml-2 text-[11px] font-normal text-ink-4">
                  {list.length} server{list.length === 1 ? '' : 's'}
                </span>
              )}
            </h3>
            <p className="text-[11px] text-ink-4">{INTRO[type]}</p>
          </div>
          <Button size="sm" disabled={discover.isPending} onClick={() => discover.mutate()}>
            {discover.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
            {discover.isPending ? 'Searching…' : 'Find on network'}
          </Button>
          <Button size="sm" onClick={() => addDraft({ type, name: '', url: '' })}>
            <Plus className="size-3.5" /> Add server
          </Button>
        </header>
        {discover.error && (
          <p className="border-t border-line px-5 py-3 text-xs text-bad" role="alert">{(discover.error as Error).message}</p>
        )}
        {found && (
          <div className="border-t border-line bg-white/[0.015]">
            <DiscoveryResults type={type} servers={found} onAdd={addDraft} pending={new Set(drafts.map((d) => d.url))} />
          </div>
        )}
        {(list.length > 0 || drafts.length > 0) && (
          <div className="divide-y divide-line border-t border-line">
            {list.map((s) => <ServerRow key={s.id} srv={s} />)}
            {drafts.map((d) => <ServerRow key={d.key} draft={d} onDone={() => dropDraft(d.key)} />)}
          </div>
        )}
      </Card>
    </li>
  );
}

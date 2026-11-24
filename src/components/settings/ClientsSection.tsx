import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, Download, LoaderCircle, PlugZap, Plus, Save, Trash2 } from 'lucide-react';
import { useClientSettings, useRemoveClient, useSaveClient, useTestClient, type ClientSettingsView, type ClientType } from '@/hooks/useClients';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';

const PORT: Record<ClientType, string> = { qbittorrent: '8080', transmission: '9091', sabnzbd: '8080', nzbget: '6789' };

function ClientRow({ c, types, onDone }: { c?: ClientSettingsView; types: { id: ClientType; name: string; fields: ('username' | 'password' | 'apiKey')[] }[]; onDone?: () => void }) {
  const blank = { type: c?.type ?? ('qbittorrent' as ClientType), name: c?.name ?? '', url: c?.url ?? '', username: c?.username ?? '', password: '', apiKey: '' };
  const [form, setForm] = useState(blank);
  const test = useTestClient();
  const save = useSaveClient();
  const remove = useRemoveClient();
  useEffect(() => setForm((f) => ({ ...f, name: c?.name ?? '', url: c?.url ?? '', username: c?.username ?? '' })), [c?.name, c?.url, c?.username]);
  const fields = types.find((t) => t.id === form.type)?.fields ?? [];
  const err = save.error instanceof ApiError ? save.error : undefined;
  const busy = test.isPending || save.isPending || remove.isPending;
  const dirty = (Object.keys(blank) as (keyof typeof blank)[]).some((k) => form[k] !== blank[k]);
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    test.reset();
    save.reset();
  };
  const input = () => ({
    id: c?.id,
    type: form.type,
    name: form.name.trim(),
    url: form.url.trim(),
    username: fields.includes('username') ? form.username.trim() : undefined,
    password: form.password || undefined,
    apiKey: form.apiKey.trim() || undefined,
  });
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(input()).catch(() => undefined);
    if (r && !c) onDone?.();
    if (r) setForm((f) => ({ ...f, password: '', apiKey: '' }));
  }
  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-3 px-5 py-4', c && !c.enabled && 'opacity-70')}>
      <div className="grid gap-3 md:grid-cols-[150px_minmax(120px,0.7fr)_minmax(180px,1.3fr)]">
        <Select aria-label="Client type" className="h-9" value={form.type} disabled={!!c} onChange={(e) => set('type', e.target.value)}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Input className="h-9" aria-label="Name" placeholder="Name, e.g. Seedbox" value={form.name} aria-invalid={err?.field === 'name'} onChange={(e) => set('name', e.target.value)} />
        <Input className="h-9" aria-label="Server address" type="url" inputMode="url" spellCheck={false} autoComplete="off" placeholder={`http://192.168.1.10:${PORT[form.type]}`} value={form.url} aria-invalid={err?.field === 'url'} onChange={(e) => set('url', e.target.value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fields.includes('username') && <Input className="h-9" aria-label="Username" autoComplete="off" placeholder="Username" value={form.username} onChange={(e) => set('username', e.target.value)} />}
        {fields.includes('password') && (
          <Input className="h-9" aria-label="Password" type="password" autoComplete="new-password" placeholder={c?.passwordSet ? 'Saved — blank keeps it' : 'Password'} value={form.password} aria-invalid={err?.field === 'password'} onChange={(e) => set('password', e.target.value)} />
        )}
        {fields.includes('apiKey') && (
          <Input className="h-9 font-mono text-[13px]" aria-label="API key" type="password" autoComplete="new-password" placeholder={c?.apiKeySet ? `Saved ${c.apiKeyHint ?? '••••'} — blank keeps it` : 'API key (Config → General)'} value={form.apiKey} aria-invalid={err?.field === 'apiKey'} onChange={(e) => set('apiKey', e.target.value)} />
        )}
      </div>
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
          ) : c ? (
            <span className="text-ink-4">{c.enabled ? 'Active' : 'Switched off'}</span>
          ) : null}
        </div>
        {c ? (
          <>
            <Switch checked={c.enabled} disabled={busy} onChange={(v) => save.mutate({ id: c.id, enabled: v })} label={c.enabled ? `Switch off ${c.name}` : `Switch on ${c.name}`} />
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => confirm(`Remove the download client "${c.name}"?`) && remove.mutate(c.id)}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>Cancel</Button>
        )}
        <Button type="button" size="sm" disabled={busy || !form.url.trim()} onClick={() => test.mutate(input())}>
          {test.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />} Test
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy || !dirty}>
          {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {c ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

/** qBittorrent, Transmission, SABnzbd and NZBGet connections. */
export function ClientsSection() {
  const q = useClientSettings();
  const [adding, setAdding] = useState(false);
  if (!q.data) return null;
  return (
    <section className="mt-8" aria-labelledby="clients-h">
      <h2 id="clients-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight"><Download className="size-4 text-brand" /> Download clients</h2>
      <p className="mb-3 text-xs text-ink-3">Connect your torrent and usenet clients for real transfer speeds, pausing, removing and speed limits.</p>
      <Card>
        <header className="flex items-center gap-3 px-5 py-3">
          <p className="min-w-0 flex-1 text-[11px] text-ink-4">Passwords and API keys stay on the StreamForge server.</p>
          {!adding && <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-3.5" /> Add client</Button>}
        </header>
        {(q.data.clients.length > 0 || adding) && (
          <div className="divide-y divide-line border-t border-line">
            {q.data.clients.map((c) => <ClientRow key={c.id} c={c} types={q.data.types} />)}
            {adding && <ClientRow types={q.data.types} onDone={() => setAdding(false)} />}
          </div>
        )}
      </Card>
    </section>
  );
}

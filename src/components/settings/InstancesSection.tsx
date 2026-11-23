import { useEffect, useState, type FormEvent } from 'react';
import { CircleCheck, CircleX, KeyRound, LoaderCircle, PlugZap, Plus, Save, Trash2 } from 'lucide-react';
import { useInstanceSettings, useRemoveInstance, useSaveInstance, useTestInstance } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ArrInstanceView, ArrKind } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';

const inputCls =
  'h-9 w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 text-sm text-ink placeholder:text-ink-4 transition outline-none focus:border-brand/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand/10 aria-[invalid=true]:border-bad/60';

const APP: Record<ArrKind, string> = { sonarr: 'Sonarr', radarr: 'Radarr' };

function InstanceRow({ kind, inst, onDone }: { kind: ArrKind; inst?: ArrInstanceView; onDone?: () => void }) {
  const blank = { name: inst?.name ?? '', url: inst?.url ?? '', apiKey: '' };
  const [form, setForm] = useState(blank);
  const test = useTestInstance();
  const save = useSaveInstance();
  const remove = useRemoveInstance();
  useEffect(() => setForm({ name: inst?.name ?? '', url: inst?.url ?? '', apiKey: '' }), [inst?.name, inst?.url]);

  const dirty = form.name !== blank.name || form.url !== blank.url || !!form.apiKey;
  const err = save.error instanceof ApiError ? save.error : undefined;
  const busy = test.isPending || save.isPending || remove.isPending;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    test.reset();
    save.reset();
  };
  const input = () => ({ id: inst?.id, kind, name: form.name.trim(), url: form.url.trim(), apiKey: form.apiKey.trim() || undefined });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = await save.mutateAsync(input()).catch(() => undefined);
    if (r && !inst) onDone?.();
    if (r) setForm((f) => ({ ...f, apiKey: '' }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className={cn('space-y-3 px-5 py-4', inst && !inst.enabled && 'opacity-70')}>
      <div className="grid gap-3 md:grid-cols-[minmax(120px,0.7fr)_minmax(180px,1.3fr)_minmax(180px,1fr)]">
        <input
          aria-label="Instance name"
          className={inputCls}
          placeholder={`Name, e.g. ${kind === 'radarr' ? '4K' : 'Anime'}`}
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
          placeholder={`https://${kind}-4k.example.com`}
          value={form.url}
          aria-invalid={err?.field === 'url'}
          onChange={(e) => set('url', e.target.value)}
        />
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-4" />
          <input
            aria-label="API key"
            className={cn(inputCls, 'pl-8 font-mono text-[13px]')}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={inst?.apiKeySet ? `Saved ${inst.apiKeyHint ?? '••••'} — blank keeps it` : 'API key'}
            value={form.apiKey}
            aria-invalid={err?.field === 'apiKey'}
            onChange={(e) => set('apiKey', e.target.value)}
          />
        </div>
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
          ) : inst ? (
            <span className="text-ink-4">{inst.enabled ? 'Active' : 'Switched off'}</span>
          ) : null}
        </div>
        {inst && (
          <>
            <Switch
              checked={inst.enabled}
              disabled={busy}
              onChange={(v) => save.mutate({ id: inst.id, enabled: v })}
              label={inst.enabled ? `Switch off ${inst.name}` : `Switch on ${inst.name}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove the ${APP[kind]} instance "${inst.name}"?`)) remove.mutate(inst.id);
              }}
            >
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </>
        )}
        {!inst && (
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
          {inst ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}

/** Additional Sonarr/Radarr instances, shown under the primary card. */
export function InstancesSection({ kind }: { kind: ArrKind }) {
  const q = useInstanceSettings();
  const [adding, setAdding] = useState(false);
  const list = q.data?.instances.filter((i) => i.kind === kind) ?? [];
  return (
    <li>
      <Card>
        <header className="flex items-center gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold">More {APP[kind]} instances</h3>
            <p className="text-[11px] text-ink-4">
              For a second {APP[kind]}, such as {kind === 'radarr' ? 'a 4K library' : 'an anime library'}. Each gets its own tab on the {APP[kind]} page.
            </p>
          </div>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Add instance
            </Button>
          )}
        </header>
        {(list.length > 0 || adding) && (
          <div className="divide-y divide-line border-t border-line">
            {list.map((i) => <InstanceRow key={i.id} kind={kind} inst={i} />)}
            {adding && <InstanceRow kind={kind} onDone={() => setAdding(false)} />}
          </div>
        )}
      </Card>
    </li>
  );
}

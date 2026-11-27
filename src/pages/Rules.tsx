import { useState, type FormEvent } from 'react';
import { CircleAlert, CircleCheck, FlaskConical, LoaderCircle, Pencil, Plus, Save, ShieldAlert, Sparkles, Trash2, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRemoveRule, useRules, useRunRule, useSaveRule, type ActionType, type ConditionType, type Rule, type RuleInput, type RulesStatus } from '@/hooks/useRules';
import { relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Status';
import { PageLoader } from '@/components/ui/Loader';
import { EmptyState, QueryState } from '@/components/ui/States';
import { Switch } from '@/components/ui/Switch';
import { t } from '@/i18n';

const IDEAS = ['diskFull', 'diskSoon', 'serviceDown', 'stalled', 'requests', 'ended'] as const;
const TEMPLATES: (RuleInput & { idea: (typeof IDEAS)[number] })[] = [
  { idea: 'diskFull', name: '', condition: 'disk_usage', value: 95, actions: ['notify', 'pause_downloads'], cooldownHours: 12, enabled: true },
  { idea: 'diskSoon', name: '', condition: 'disk_days_left', value: 14, actions: ['notify'], cooldownHours: 72, enabled: true },
  { idea: 'serviceDown', name: '', condition: 'service_offline', value: 15, actions: ['notify'], cooldownHours: 0, enabled: true },
  { idea: 'stalled', name: '', condition: 'stalled_downloads', value: 3, actions: ['notify', 'run_cleanup'], cooldownHours: 6, enabled: true },
  { idea: 'requests', name: '', condition: 'pending_requests', value: 5, actions: ['notify'], cooldownHours: 24, enabled: true },
  { idea: 'ended', name: '', condition: 'ended_unwatched', value: 180, actions: ['notify'], cooldownHours: 24 * 7, enabled: true },
];

const COOLDOWNS = [0, 1, 6, 12, 24, 72, 168] as const;
const cooldownLabel = (h: number) =>
  h === 0 ? t('admin.rules.once') : h === 24 ? t('admin.rules.day') : h === 168 ? t('admin.rules.week') : h === 72 ? t('admin.rules.days', { count: 3 }) : t('admin.rules.hours', { count: h });

const CONDITIONS = ['disk_usage', 'disk_days_left', 'service_offline', 'stalled_downloads', 'pending_requests', 'active_streams', 'ended_unwatched'] as const;
const ACTIONS = ['notify', 'pause_downloads', 'resume_downloads', 'run_cleanup', 'unmonitor'] as const;
/** The server names conditions and actions in English; known ones are shown in the active language. */
const condLabel = (meta: RulesStatus, k: ConditionType) => ((CONDITIONS as readonly string[]).includes(k) ? t(`admin.rules.cond.${k as (typeof CONDITIONS)[number]}`) : meta.conditions[k].label);
const actionLabel = (meta: RulesStatus, k: ActionType) => ((ACTIONS as readonly string[]).includes(k) ? t(`admin.rules.action.${k as (typeof ACTIONS)[number]}`) : meta.actions[k].label);
const UNITS = ['%', 'days', 'minutes', 'downloads', 'requests', 'streams'] as const;
const unitLabel = (u: string) => (u === '%' ? '%' : (UNITS as readonly string[]).includes(u) ? t(`admin.rules.unit.${u as Exclude<(typeof UNITS)[number], '%'>}`) : u);

const lower = (s: string) => s.charAt(0).toLocaleLowerCase() + s.slice(1);
const allowed = (meta: RulesStatus, a: ActionType, c: ConditionType) => !meta.actions[a].for || meta.actions[a].for!.includes(c);

function RuleForm({ meta, rule, initial, onDone }: { meta: RulesStatus; rule?: Rule; initial?: RuleInput; onDone: () => void }) {
  const [f, setF] = useState<RuleInput>(rule ?? initial ?? { name: '', enabled: true, condition: 'disk_usage', value: 90, actions: ['notify'], cooldownHours: 24 });
  const save = useSaveRule();
  const c = meta.conditions[f.condition];
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ ...f, id: rule?.id }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
      <Input aria-label={t('admin.rules.name')} placeholder={condLabel(meta, f.condition)} value={f.name} onChange={(e) => set('name', e.target.value)} className="h-9" />
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="text-xs text-ink-3">
          {t('admin.rules.if')}
          <Select
            className="mt-1 h-9"
            value={f.condition}
            onChange={(e) => {
              const cond = e.target.value as ConditionType;
              setF((x) => ({ ...x, condition: cond, value: meta.conditions[cond].param.default, actions: x.actions.filter((a) => allowed(meta, a, cond)) }));
            }}
          >
            {(Object.keys(meta.conditions) as ConditionType[]).map((k) => <option key={k} value={k}>{condLabel(meta, k)}</option>)}
          </Select>
        </label>
        <label className="text-xs text-ink-3">
          N ({unitLabel(c.param.unit)})
          <Input className="mt-1 h-9" type="number" min={c.param.min} max={c.param.max} value={f.value} onChange={(e) => set('value', Number(e.target.value))} />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs text-ink-3">{t('widgets.cleanup.then')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(meta.actions) as ActionType[]).filter((a) => allowed(meta, a, f.condition)).map((a) => {
            const on = f.actions.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => set('actions', on ? f.actions.filter((x) => x !== a) : [...f.actions, a])}
                className={cn('rounded-lg border px-2.5 py-1 text-xs transition', on ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
              >
                {actionLabel(meta, a)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('admin.rules.repeat')} className="h-8 w-56 text-xs" value={f.cooldownHours} onChange={(e) => set('cooldownHours', Number(e.target.value))}>
          {COOLDOWNS.map((h) => <option key={h} value={h}>{cooldownLabel(h)}</option>)}
        </Select>
        <span className="mr-auto text-[11px] text-ink-4">{t('admin.rules.checked')}</span>
        {save.error && <span className="text-xs text-bad">{(save.error as Error).message}</span>}
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>{t('media.cancel')}</Button>
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
          {save.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} {rule ? t('common.save') : t('admin.rules.add')}
        </Button>
      </div>
    </form>
  );
}

function RuleRow({ meta, r }: { meta: RulesStatus; r: Rule }) {
  const [editing, setEditing] = useState(false);
  const save = useSaveRule();
  const remove = useRemoveRule();
  const run = useRunRule();
  if (editing) return <RuleForm meta={meta} rule={r} onDone={() => setEditing(false)} />;
  const s = r.state;
  return (
    <div className={cn('flex items-start gap-3 px-5 py-4', !r.enabled && 'opacity-60')}>
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line', s.matched ? 'text-warn' : 'text-ink-4')}>
        {s.lastError ? <CircleAlert className="size-4 text-bad" /> : s.matched ? <Zap className="size-4" /> : <CircleCheck className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{r.name}</div>
        <div className="text-[11px] text-ink-3">
          {t('admin.rules.if')} {lower(condLabel(meta, r.condition).replace(/\bN\b/, String(r.value)))} → {r.actions.map((a) => lower(actionLabel(meta, a))).join(', ')}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-4">
          {s.lastError ? <span className="text-bad">{s.lastError}</span> : s.summary ? <span>{s.summary}</span> : <span>{t('admin.rules.notChecked')}</span>}
          {s.lastFired && <Pill>{t('admin.rules.fired', { when: relative(s.lastFired) })}</Pill>}
        </div>
        {run.data && <p className={cn('mt-1 text-[11px]', run.data.matched ? 'text-warn' : 'text-ok')}>{run.data.matched ? t('admin.rules.wouldFire') : t('admin.rules.wouldntFire')} — {run.data.summary}</p>}
        {(run.error ?? remove.error) && <p className="mt-1 text-[11px] text-bad">{((run.error ?? remove.error) as Error).message}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="icon" variant="ghost" className="size-8" title={t('admin.rules.testHint')} aria-label={t('admin.rules.test', { name: r.name })} disabled={run.isPending} onClick={() => run.mutate({ id: r.id, fire: false })}>
          {run.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label={t('admin.rules.edit', { name: r.name })} onClick={() => setEditing(true)}><Pencil className="size-4" /></Button>
        <Button size="icon" variant="ghost" className="size-8" aria-label={t('admin.rules.delete', { name: r.name })} disabled={remove.isPending} onClick={() => confirm(t('admin.rules.confirmDelete', { name: r.name })) && remove.mutate(r.id)}><Trash2 className="size-4" /></Button>
        <Switch checked={r.enabled} disabled={save.isPending} onChange={(v) => save.mutate({ ...r, enabled: v })} label={r.enabled ? t('admin.rules.off', { name: r.name }) : t('admin.rules.on', { name: r.name })} />
      </div>
    </div>
  );
}

export default function RulesPage() {
  const { user } = useAuth();
  const q = useRules();
  const [adding, setAdding] = useState<RuleInput | null>(null);
  if (!user?.isAdmin) return <Card><EmptyState icon={ShieldAlert} title={t('settings.adminsOnly')} /></Card>;
  return (
    <>
      <PageHeader
        eyebrow={t('admin.rules.eyebrow')}
        title={t('nav.rules')}
        description={t('admin.rules.description')}
        actions={!adding && <Button variant="primary" size="sm" onClick={() => setAdding({ name: '', enabled: true, condition: 'disk_usage', value: 90, actions: ['notify'], cooldownHours: 24 })}><Plus className="size-3.5" /> {t('admin.rules.new')}</Button>}
      />
      <QueryState query={q} skeleton={<PageLoader label={t('admin.rules.loading')} />}>
        {(d) => (
          <div className="space-y-5">
            {(d.rules.length > 0 || adding) && (
              <Card>
                <div className="divide-y divide-line">
                  {d.rules.map((r) => <RuleRow key={r.id} meta={d} r={r} />)}
                  {adding && <RuleForm key={JSON.stringify(adding)} meta={d} initial={adding} onDone={() => setAdding(null)} />}
                </div>
              </Card>
            )}
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-2"><Sparkles className="size-4 text-brand" /> {t('admin.rules.ideas')}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {TEMPLATES.map(({ idea, ...rule }) => (
                  <button key={idea} onClick={() => setAdding({ ...rule, name: t(`admin.rules.idea.${idea}.name`) })} className="card rounded-2xl p-4 text-left transition hover:bg-white/[0.04]">
                    <div className="text-[13px] font-medium">{t(`admin.rules.idea.${idea}.name`)}</div>
                    <div className="mt-0.5 text-[11px] text-ink-4">{t(`admin.rules.idea.${idea}.hint`)}</div>
                  </button>
                ))}
              </div>
            </section>
            <p className="text-[11px] text-ink-4">{t('admin.rules.note')}</p>
          </div>
        )}
      </QueryState>
    </>
  );
}

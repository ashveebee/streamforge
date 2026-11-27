import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, EyeOff, GripVertical, LayoutGrid, Plus, RefreshCw, RotateCcw, Scaling } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHealth, useNowPlaying, useRecheck, useServiceConfig, useCanSee } from '@/hooks/queries';
import { useLocalState } from '@/hooks/useLocalState';
import { greeting, relative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { StatusDot } from '@/components/ui/Status';
import {
  DEFAULT_LAYOUT,
  normaliseLayout,
  SIZE_CLASS,
  SIZES,
  WIDGET_MAP,
  WIDGETS,
  type Layout,
  type WidgetSize,
} from '@/components/widgets/registry';
import { getLocale, useT, type MessageKey } from '@/i18n';

/** A widget's name in the active language, or its English name if a new widget has no translation yet. */
function useWidgetTitle() {
  const t = useT();
  return (id: string) => {
    const key = `dashboard.widgets.${id}`;
    const s = t(key as MessageKey);
    return s === key ? (WIDGET_MAP.get(id)?.title ?? id) : s;
  };
}

function SortableWidget({
  id,
  size,
  editing,
  onHide,
  onResize,
}: {
  id: string;
  size: WidgetSize;
  editing: boolean;
  onHide: () => void;
  onResize: () => void;
}) {
  const t = useT();
  const def = WIDGET_MAP.get(id)!;
  const title = useWidgetTitle()(id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  const Component = def.component;
  return (
    <motion.div
      layout={!isDragging}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(SIZE_CLASS[size], 'relative min-w-0', isDragging && 'z-20')}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className={cn(
          'h-full transition-all duration-300',
          editing && 'pointer-events-none rounded-[1.35rem] opacity-90 ring-2 ring-brand/30 ring-offset-4 ring-offset-canvas select-none',
          isDragging && 'scale-[1.01] opacity-100 shadow-2xl ring-brand/70',
        )}
      >
        <Component />
      </div>
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="glass absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl p-1 shadow-xl"
          >
            <button
              {...attributes}
              {...listeners}
              className="flex h-8 cursor-grab items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-ink active:cursor-grabbing"
              aria-label={t('dashboard.move', { widget: title })}
            >
              <GripVertical className="size-4 text-ink-3" />
              {title}
            </button>
            <span className="mx-0.5 h-5 w-px bg-line-strong" />
            <button onClick={onResize} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-ink-2 hover:bg-white/10" title={t('dashboard.changeWidth')}>
              <Scaling className="size-3.5" />
              <span className="tabular">{size === 'full' ? t('dashboard.full') : SIZE_FRACTION[size]}</span>
            </button>
            <button onClick={onHide} className="grid size-8 place-items-center rounded-lg text-ink-2 hover:bg-white/10 hover:text-bad" title={t('dashboard.hide')}>
              <EyeOff className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const SIZE_FRACTION: Record<Exclude<WidgetSize, 'full'>, string> = { sm: '⅓', md: '½', lg: '⅔' };

function Summary() {
  const t = useT();
  const health = useHealth();
  const playing = useNowPlaying();
  const s = health.data?.summary;
  if (!s) return <span className="text-ink-4">{t('dashboard.checking')}</span>;
  const configured = s.healthy + s.degraded + s.offline;
  const status = s.offline ? 'offline' : s.degraded ? 'degraded' : 'healthy';
  // Plural by the total ("1 of 3 services") in English; each language picks its own form.
  const text = s.offline
    ? t('dashboard.offline', { count: s.offline, total: configured })
    : s.degraded
      ? t('dashboard.degraded', { count: s.degraded, total: configured })
      : t('dashboard.healthy', { count: configured });
  const streams = playing.data?.length ?? 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusDot status={status} size={7} />
      <span className="text-ink-2">{text}</span>
      <span className="text-ink-4">·</span>
      <span>{streams ? t('dashboard.streams', { count: streams }) : t('dashboard.noStreams')}</span>
      {health.data?.checkedAt && (
        <>
          <span className="text-ink-4">·</span>
          <span className="text-ink-4">{t('dashboard.checked', { when: relative(health.data.checkedAt) })}</span>
        </>
      )}
    </span>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const t = useT();
  const widgetTitle = useWidgetTitle();
  const config = useServiceConfig();
  const canSee = useCanSee();
  const recheck = useRecheck();
  const [stored, setStored] = useLocalState<Layout>(`sf:layout:v1:${user?.id ?? 'anon'}`, DEFAULT_LAYOUT);
  const layout = useMemo(() => normaliseLayout(stored), [stored]);
  const [editing, setEditing] = useState(false);

  const available = (id: string) => {
    const def = WIDGET_MAP.get(id);
    if (def?.area && !canSee(def.area)) return false;
    const req = def?.requires;
    if (!req || !config.data) return true;
    return req.some((s) => config.data.services[s]);
  };
  const visible = layout.order.filter((id) => !layout.hidden.includes(id) && available(id));
  const hidden = layout.hidden.filter(available);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.order.indexOf(String(e.active.id));
    const to = layout.order.indexOf(String(e.over.id));
    setStored({ ...layout, order: arrayMove(layout.order, from, to) });
  };

  const sizeOf = (id: string) => layout.sizes[id] ?? WIDGET_MAP.get(id)!.defaultSize;
  const cycleSize = (id: string) => {
    const next = SIZES[(SIZES.indexOf(sizeOf(id)) + 1) % SIZES.length];
    setStored({ ...layout, sizes: { ...layout.sizes, [id]: next } });
  };

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString(getLocale(), { weekday: 'long', month: 'long', day: 'numeric' })}
        title={
          <>
            {greeting()}, <span className="text-gradient">{user?.name}</span>
          </>
        }
        description={<Summary />}
        actions={
          <>
            {editing && (
              <Button variant="ghost" size="sm" onClick={() => setStored(DEFAULT_LAYOUT)}>
                <RotateCcw className="size-3.5" /> {t('common.reset')}
              </Button>
            )}
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
                <RefreshCw className={cn('size-3.5', recheck.isPending && 'animate-spin')} /> {t('common.refresh')}
              </Button>
            )}
            <Button variant={editing ? 'primary' : 'outline'} size="sm" onClick={() => setEditing((e) => !e)}>
              {editing ? <Check className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
              {editing ? t('common.done') : t('dashboard.customise')}
            </Button>
          </>
        }
      />

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="card mb-6 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 text-xs text-ink-3">
                  {t('dashboard.editHint')} {hidden.length ? t('dashboard.hiddenWidgets') : t('dashboard.allVisible')}
                </span>
                {hidden.map((id) => (
                  <button
                    key={id}
                    onClick={() => setStored({ ...layout, hidden: layout.hidden.filter((h) => h !== id) })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-2.5 py-1.5 text-xs text-ink-2 transition hover:border-brand/50 hover:bg-brand/5 hover:text-ink"
                  >
                    <Plus className="size-3.5" /> {widgetTitle(id)}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-4 lg:gap-5">
            <AnimatePresence mode="popLayout">
              {visible.map((id) => (
                <SortableWidget
                  key={id}
                  id={id}
                  size={sizeOf(id)}
                  editing={editing}
                  onHide={() => setStored({ ...layout, hidden: [...layout.hidden, id] })}
                  onResize={() => cycleSize(id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </SortableContext>
      </DndContext>

      {visible.length === 0 && (
        <div className="card grid place-items-center p-12 text-center text-sm text-ink-3">
          {t('dashboard.allHidden')}
        </div>
      )}
      <p className="mt-10 text-center text-[11px] text-ink-4">{t('dashboard.footer', { count: WIDGETS.length })}</p>
    </>
  );
}

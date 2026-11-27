import { useSearchParams } from 'react-router';
import { useInstances, useJellyfinServers, useMainServer } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import type { ArrKind, MediaServerType } from '@/lib/types';
import { t } from '@/i18n';

/** The instance chosen via `?instance=`, falling back to the first one. */
export function useSelectedInstance(kind: ArrKind) {
  const [params] = useSearchParams();
  const list = useInstances(kind);
  const wanted = params.get('instance');
  return list.find((i) => i.id === wanted)?.id ?? list[0]?.id;
}

/** Tabs for switching between Sonarr/Radarr instances; hidden when there's only one. */
export function InstanceTabs({ kind }: { kind: ArrKind }) {
  const list = useInstances(kind);
  const current = useSelectedInstance(kind);
  return <Tabs list={list} current={current} label={t('ui.instance')} />;
}

/** Media servers of one kind (Jellyfin includes the main server), first one first. */
export function useServersOfType(type: MediaServerType) {
  return useJellyfinServers().filter((s) => s.type === type);
}

/**
 * The server of a kind chosen via `?instance=`. Defaults to the first one:
 * the main server on the Jellyfin page. Undefined when there's none of that kind.
 */
export function useSelectedMediaServer(type: MediaServerType) {
  const [params] = useSearchParams();
  const list = useServersOfType(type);
  const main = useMainServer();
  const wanted = params.get('instance');
  return list.find((s) => s.id === wanted)?.id ?? list[0]?.id ?? (type === 'jellyfin' && !main.other ? 'jellyfin' : undefined);
}

/** Tabs for switching between servers of one kind; hidden when there's only one. */
export function MediaServerTabs({ type }: { type: MediaServerType }) {
  const list = useServersOfType(type);
  const current = useSelectedMediaServer(type);
  // The first server of a kind is the default, so it needs no `?instance=`.
  return <Tabs list={list.map((s, i) => ({ ...s, primary: i === 0 }))} current={current} label={`${type[0]!.toUpperCase()}${type.slice(1)} server`} />;
}

function Tabs({ list, current, label }: { list: { id: string; name: string; primary: boolean }[]; current?: string; label: string }) {
  const [params, setParams] = useSearchParams();
  if (list.length < 2) return null;
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex flex-wrap gap-1.5">
      {list.map((i) => (
        <button
          key={i.id}
          role="tab"
          aria-selected={i.id === current}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (i.primary) next.delete('instance');
            else next.set('instance', i.id);
            setParams(next, { replace: true });
          }}
          className={cn(
            'h-8 rounded-xl border px-3 text-xs font-medium transition',
            i.id === current ? 'border-white/15 bg-white/[0.08] text-ink' : 'border-line text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
          )}
        >
          {i.name}
        </button>
      ))}
    </div>
  );
}

import { useSearchParams } from 'react-router';
import { useInstances, useJellyfinServers } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import type { ArrKind } from '@/lib/types';

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
  return <Tabs list={list} current={current} label="Instance" />;
}

/** The media server chosen via `?instance=`; `jellyfin` (the main one) by default. */
export function useSelectedJellyfinServer() {
  const [params] = useSearchParams();
  const list = useJellyfinServers();
  const wanted = params.get('instance');
  return list.find((s) => s.id === wanted)?.id ?? 'jellyfin';
}

/** Jellyfin, Emby or Plex: the type of the media server chosen via `?instance=`. */
export function useSelectedServerType() {
  const list = useJellyfinServers();
  const current = useSelectedJellyfinServer();
  return list.find((s) => s.id === current)?.type ?? 'jellyfin';
}

const TYPE_NAMES = { jellyfin: 'Jellyfin', emby: 'Emby', plex: 'Plex' } as const;

/** Tabs for switching between media servers; hidden when there's only one. */
export function JellyfinServerTabs() {
  const list = useJellyfinServers();
  const current = useSelectedJellyfinServer();
  // Label the type when servers of more than one kind are set up.
  const mixed = new Set(list.map((s) => s.type)).size > 1;
  return <Tabs list={list.map((s) => ({ ...s, name: mixed ? `${s.name} · ${TYPE_NAMES[s.type]}` : s.name }))} current={current} label="Media server" />;
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

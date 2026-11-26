import { cn } from '@/lib/cn';

export type MediaServerType = 'jellyfin' | 'plex' | 'emby';

export const SERVER_COLOR: Record<MediaServerType, string> = { jellyfin: 'var(--color-jellyfin)', plex: 'var(--color-plex)', emby: 'var(--color-emby)' };
export const SERVER_NAME: Record<MediaServerType, string> = { jellyfin: 'Jellyfin', plex: 'Plex', emby: 'Emby' };

/** A media server's name with a dot in its colour (purple Jellyfin, amber Plex, green Emby). */
export function ServerTag({ type, name, className }: { type: MediaServerType; name?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <i className="size-[7px] rounded-full" style={{ background: SERVER_COLOR[type] }} />
      {name ?? SERVER_NAME[type]}
    </span>
  );
}

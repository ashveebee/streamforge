import { BookOpen, Captions, Clapperboard, Film, HardDrive, Inbox, MonitorPlay, Music, Radar, Tv, Projector } from 'lucide-react';
import type { MediaServerType, ServiceHealth, ServiceId } from '@/lib/types';
import { cn } from '@/lib/cn';

export const SERVICES: Record<ServiceId, { name: string; color: string; icon: typeof Film; tagline: string; path: string }> = {
  jellyfin: { name: 'Jellyfin', color: 'var(--color-jellyfin)', icon: Clapperboard, tagline: 'Media server', path: '/jellyfin' },
  sonarr: { name: 'Sonarr', color: 'var(--color-sonarr)', icon: Tv, tagline: 'TV series', path: '/sonarr' },
  radarr: { name: 'Radarr', color: 'var(--color-radarr)', icon: Film, tagline: 'Movies', path: '/radarr' },
  prowlarr: { name: 'Prowlarr', color: 'var(--color-prowlarr)', icon: Radar, tagline: 'Indexers', path: '/prowlarr' },
  seerr: { name: 'Seerr', color: 'var(--color-seerr)', icon: Inbox, tagline: 'Requests', path: '/seerr' },
  infinidisk: { name: 'Infinidisk', color: 'var(--color-infinidisk)', icon: HardDrive, tagline: 'Storage', path: '/infinidisk' },
  bazarr: { name: 'Bazarr', color: 'var(--color-bazarr)', icon: Captions, tagline: 'Subtitles', path: '/bazarr' },
  lidarr: { name: 'Lidarr', color: 'var(--color-lidarr)', icon: Music, tagline: 'Music', path: '/lidarr' },
  readarr: { name: 'Readarr', color: 'var(--color-readarr)', icon: BookOpen, tagline: 'Books', path: '/readarr' },
};

type Meta = (typeof SERVICES)[ServiceId];

/**
 * Emby and Plex servers are monitored as extra media servers (they share the
 * Jellyfin access area), but get their own page, colour and icon.
 */
export const MEDIA_SERVERS: Record<MediaServerType, Meta> = {
  jellyfin: SERVICES.jellyfin,
  emby: { name: 'Emby', color: 'var(--color-emby)', icon: MonitorPlay, tagline: 'Media server', path: '/emby' },
  plex: { name: 'Plex', color: 'var(--color-plex)', icon: Projector, tagline: 'Media server', path: '/plex' },
};

export type IconId = ServiceId | 'emby' | 'plex';
const metaOf = (id: IconId): Meta => (id === 'emby' || id === 'plex' ? MEDIA_SERVERS[id] : SERVICES[id]);

/** Display details for a health entry: an Emby or Plex server uses its own. */
export function healthMeta(s: Pick<ServiceHealth, 'kind' | 'serverType'>): Meta & { iconId: IconId } {
  const id: IconId = s.serverType === 'emby' || s.serverType === 'plex' ? s.serverType : s.kind;
  return { ...metaOf(id), iconId: id };
}

export function ServiceIcon({ id, size = 36, className }: { id: IconId; size?: number; className?: string }) {
  const { icon: Icon, color } = metaOf(id);
  return (
    <span
      className={cn('relative grid shrink-0 place-items-center rounded-xl border border-white/10', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(145deg, color-mix(in oklab, ${color} 28%, #0d0f16), color-mix(in oklab, ${color} 8%, #0d0f16))`,
        boxShadow: `0 8px 24px -12px ${color}, inset 0 1px 0 rgb(255 255 255 / 0.08)`,
      }}
    >
      <Icon className="text-white" style={{ width: size * 0.46, height: size * 0.46, color }} />
    </span>
  );
}

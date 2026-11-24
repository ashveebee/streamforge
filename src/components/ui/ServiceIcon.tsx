import { BookOpen, Captions, Clapperboard, Film, HardDrive, Inbox, Music, Radar, Tv } from 'lucide-react';
import type { ServiceId } from '@/lib/types';
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

export function ServiceIcon({ id, size = 36, className }: { id: ServiceId; size?: number; className?: string }) {
  const { icon: Icon, color } = SERVICES[id];
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

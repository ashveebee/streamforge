import { Link } from 'react-router';
import { cn } from '@/lib/cn';

/** Wraps a title (and its artwork) in a link to its details page, when there is one. */
export function TitleLink({ to, className, children, title }: { to?: string; className?: string; children: React.ReactNode; title?: string }) {
  if (!to) return <span className={className}>{children}</span>;
  return (
    <Link to={to} title={title} className={cn('transition hover:text-brand focus-visible:text-brand', className)}>
      {children}
    </Link>
  );
}

/** Details path for an item from Sonarr/Radarr (by TMDB id). */
export const arrTitlePath = (source: 'sonarr' | 'radarr', tmdbId?: number) => (tmdbId ? `/media/${source === 'sonarr' ? 'tv' : 'movie'}/${tmdbId}` : undefined);

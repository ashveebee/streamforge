import { AnimatePresence } from 'motion/react';
import { PlayCircle, Repeat, Zap } from 'lucide-react';
import { useNowPlaying } from '@/hooks/queries';
import { PageHeader } from '@/components/layout/PageHeader';
import { StreamCard } from '@/components/widgets/StreamCard';
import { NowPlayingHero } from '@/components/widgets/NowPlayingHero';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
import { Loader } from '@/components/ui/Loader';
import { useAuth } from '@/hooks/useAuth';
import { PlaybackGuardCard } from '@/components/widgets/PlaybackGuardCard';

export default function NowPlayingPage() {
  const q = useNowPlaying();
  const { user } = useAuth();
  const streams = q.data ?? [];
  const transcodes = streams.filter((s) => s.state.playMethod === 'Transcode').length;
  const users = new Set(streams.map((s) => s.user.name)).size;
  return (
    <>
      <PageHeader eyebrow="Jellyfin" title="Now Playing" description="Every active stream across your server, updated live." />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Active streams" value={q.data ? streams.length : undefined} icon={PlayCircle} accent="var(--color-brand)" />
        <StatTile label="Direct play" value={q.data ? streams.length - transcodes : undefined} icon={Zap} accent="var(--color-ok)" hint={q.data ? `${users} ${users === 1 ? 'viewer' : 'viewers'}` : undefined} />
        <StatTile label="Transcoding" value={q.data ? transcodes : undefined} icon={Repeat} accent="var(--color-warn)" />
      </div>
      {streams.length > 0 && <div className="mb-5"><NowPlayingHero /></div>}
      {q.isPending ? (
        <Card className="py-6">
          <Loader
            label="Finding who’s watching"
            hint="Asking Jellyfin for every active stream…"
            slowHint="Jellyfin is taking a while to answer. Streams will appear as soon as it does."
          />
        </Card>
      ) : q.isError && !q.data ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : streams.length === 0 ? (
        <Card className="py-10">
          <EmptyState icon={PlayCircle} title="Nothing is playing" description="When someone starts watching or listening on any Jellyfin client, the stream will appear here instantly." />
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {streams.map((s, i) => <StreamCard key={s.sessionId} s={s} fetchedAt={q.dataUpdatedAt} index={i} />)}
          </AnimatePresence>
        </div>
      )}
      {user?.isAdmin && <div className="mt-5"><PlaybackGuardCard /></div>}
    </>
  );
}

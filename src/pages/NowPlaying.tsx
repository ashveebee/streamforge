import { AnimatePresence } from 'motion/react';
import { PlayCircle, Repeat, Zap } from 'lucide-react';
import { useNowPlaying } from '@/hooks/queries';
import { PageHeader } from '@/components/layout/PageHeader';
import { StreamCard } from '@/components/widgets/StreamCard';
import { NowPlayingHero } from '@/components/widgets/NowPlayingHero';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
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
        <StatTile label="Active streams" value={streams.length} icon={PlayCircle} accent="var(--color-brand)" />
        <StatTile label="Direct play" value={streams.length - transcodes} icon={Zap} accent="var(--color-ok)" hint={`${users} ${users === 1 ? 'viewer' : 'viewers'}`} />
        <StatTile label="Transcoding" value={transcodes} icon={Repeat} accent="var(--color-warn)" />
      </div>
      {streams.length > 0 && <div className="mb-5"><NowPlayingHero /></div>}
      {q.isPending ? (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[480px] rounded-[1.25rem]" />)}</div>
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

import { AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { PlayCircle, Radar, Repeat, Zap } from 'lucide-react';
import { useJellyfinServers, useNowPlaying } from '@/hooks/queries';
import { PageHeader } from '@/components/layout/PageHeader';
import { StreamCard } from '@/components/widgets/StreamCard';
import { streamKey } from '@/components/widgets/playback';
import { NowPlayingHero } from '@/components/widgets/NowPlayingHero';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Card } from '@/components/ui/Card';
import { StatTile } from '@/components/ui/Stat';
import { Loader } from '@/components/ui/Loader';
import { useAuth } from '@/hooks/useAuth';
import { useDiagnosis } from '@/hooks/useDiagnosis';
import { PlaybackGuardCard } from '@/components/widgets/PlaybackGuardCard';

export default function NowPlayingPage() {
  const q = useNowPlaying();
  const servers = useJellyfinServers().length;
  const { user } = useAuth();
  const streams = q.data ?? [];
  const transcodes = streams.filter((s) => s.state.playMethod === 'Transcode').length;
  const users = new Set(streams.map((s) => s.user.name)).size;
  return (
    <>
      <PageHeader
        eyebrow="Media servers"
        title="Now Playing"
        description={servers > 1 ? `Every active stream across your ${servers} media servers, updated live.` : 'Every active stream across your server, updated live.'}
        actions={user?.isAdmin ? <BufferingLink /> : undefined}
      />
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
            {streams.map((s, i) => <StreamCard key={streamKey(s)} s={s} fetchedAt={q.dataUpdatedAt} index={i} />)}
          </AnimatePresence>
        </div>
      )}
      {user?.isAdmin && <div className="mt-5"><PlaybackGuardCard /></div>}
    </>
  );
}

/** Admins: the way into the buffering diagnosis, with stalls from the last day. */
function BufferingLink() {
  const d = useDiagnosis();
  const recent = d.data?.incidents.filter((i) => i.start > Date.now() - 86_400_000).length ?? 0;
  return (
    <Link
      to="/now-playing/buffering"
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-strong bg-white/[0.02] px-3.5 text-[13px] font-medium text-ink-2 transition hover:bg-white/[0.06] hover:text-ink"
    >
      <Radar className="size-4" />
      Why did it buffer?
      {recent > 0 && (
        <span className="rounded-full bg-bad/15 px-1.5 py-px text-[10.5px] font-semibold text-bad tabular" title={`${recent} stall${recent === 1 ? '' : 's'} in the last 24 hours`}>
          {recent}
        </span>
      )}
    </Link>
  );
}

import { AnimatePresence } from 'motion/react';
import { Link } from 'react-router';
import { PlayCircle, Radar, Repeat, Zap } from 'lucide-react';
import { useJellyfinServers, useMainServer, useNowPlaying } from '@/hooks/queries';
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
import { useT } from '@/i18n';

export default function NowPlayingPage() {
  const q = useNowPlaying();
  const servers = useJellyfinServers().length;
  const main = useMainServer();
  const { user } = useAuth();
  const t = useT();
  const streams = q.data ?? [];
  const transcodes = streams.filter((s) => s.state.playMethod === 'Transcode').length;
  const users = new Set(streams.map((s) => s.user.name)).size;
  return (
    <>
      <PageHeader
        eyebrow={t('watch.now.eyebrow')}
        title={t('nav.nowPlaying')}
        description={servers > 1 ? t('watch.now.descriptionMany', { count: servers }) : t('watch.now.description')}
        actions={user?.isAdmin ? <BufferingLink /> : undefined}
      />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('watch.now.active')} value={q.data ? streams.length : undefined} icon={PlayCircle} accent="var(--color-brand)" />
        <StatTile label={t('ui.method.directPlay')} value={q.data ? streams.length - transcodes : undefined} icon={Zap} accent="var(--color-ok)" hint={q.data ? t('watch.now.viewers', { count: users }) : undefined} />
        <StatTile label={t('watch.now.transcoding')} value={q.data ? transcodes : undefined} icon={Repeat} accent="var(--color-warn)" />
      </div>
      {streams.length > 0 && <div className="mb-5"><NowPlayingHero /></div>}
      {q.isPending ? (
        <Card className="py-6">
          <Loader
            label={t('watch.now.finding')}
            hint={t('watch.now.asking', { server: main.name })}
            slowHint={t('watch.now.slow', { server: main.name })}
          />
        </Card>
      ) : q.isError && !q.data ? (
        <Card><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Card>
      ) : streams.length === 0 ? (
        <Card className="py-10">
          <EmptyState icon={PlayCircle} title={t('watch.now.nothing')} description={t('watch.now.nothingHint', { server: main.name })} />
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
  const t = useT();
  const recent = d.data?.incidents.filter((i) => i.start > Date.now() - 86_400_000).length ?? 0;
  return (
    <Link
      to="/now-playing/buffering"
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-line-strong bg-white/[0.02] px-3.5 text-[13px] font-medium text-ink-2 transition hover:bg-white/[0.06] hover:text-ink"
    >
      <Radar className="size-4" />
      {t('palette.pages.whyBuffer')}
      {recent > 0 && (
        <span className="rounded-full bg-bad/15 px-1.5 py-px text-[10.5px] font-semibold text-bad tabular" title={t('watch.now.stalls', { count: recent })}>
          {recent}
        </span>
      )}
    </Link>
  );
}

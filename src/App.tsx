import { Suspense } from 'react';
import { lazyPage } from '@/lib/lazyPage';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useRouteError } from 'react-router';
import { AnimatePresence } from 'motion/react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCanSee } from '@/hooks/queries';
import type { Area } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';
import { AppShell } from '@/components/layout/AppShell';
import { Loader } from '@/components/ui/Loader';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';

const NowPlaying = lazyPage(() => import('@/pages/NowPlaying'));
const MediaServer = lazyPage(() => import('@/pages/MediaServer'));
const Sonarr = lazyPage(() => import('@/pages/Arr').then((m) => ({ default: m.SonarrPage })));
const Radarr = lazyPage(() => import('@/pages/Arr').then((m) => ({ default: m.RadarrPage })));
const Prowlarr = lazyPage(() => import('@/pages/Prowlarr'));
const Seerr = lazyPage(() => import('@/pages/Seerr'));
const Bazarr = lazyPage(() => import('@/pages/Bazarr'));
const Lidarr = lazyPage(() => import('@/pages/Music').then((m) => ({ default: m.LidarrPage })));
const Readarr = lazyPage(() => import('@/pages/Music').then((m) => ({ default: m.ReadarrPage })));
const Infinidisk = lazyPage(() => import('@/pages/Infinidisk'));
const System = lazyPage(() => import('@/pages/System'));
const Stats = lazyPage(() => import('@/pages/Stats'));
const LibraryHealth = lazyPage(() => import('@/pages/LibraryHealth'));
const Rules = lazyPage(() => import('@/pages/Rules'));
const Digest = lazyPage(() => import('@/pages/Digest'));
const Media = lazyPage(() => import('@/pages/MediaDetails').then((m) => ({ default: m.MediaPage })));
const JellyfinMedia = lazyPage(() => import('@/pages/MediaDetails').then((m) => ({ default: m.JellyfinMediaPage })));
const Me = lazyPage(() => import('@/pages/Me'));
const Downloads = lazyPage(() => import('@/pages/Downloads'));
const Audit = lazyPage(() => import('@/pages/Audit'));
const Diagnose = lazyPage(() => import('@/pages/Diagnose'));
const Settings = lazyPage(() => import('@/pages/Settings'));
const NotFound = lazyPage(() => import('@/pages/NotFound'));

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Loader label="Starting StreamForge" slowHint="Still connecting to the server…" />
    </div>
  );
}

function Protected() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <AppShell />;
}

function PublicOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <Splash />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Pages a member hasn't been given access to say so instead of erroring. */
function AreaGate({ area, children }: { area?: Area; children: React.ReactNode }) {
  const canSee = useCanSee();
  if (area && !canSee(area)) {
    return (
      <Card>
        <EmptyState icon={Lock} title="Not available" description="Your account doesn’t have access to this page. Ask a Jellyfin administrator if you need it." />
      </Card>
    );
  }
  return <>{children}</>;
}

const page = (el: React.ReactNode, area?: Area) => (
  <Suspense fallback={<Loader className="min-h-[60vh]" label="Loading" />}>
    <AreaGate area={area}>{el}</AreaGate>
  </Suspense>
);

/** Shown instead of a blank page if a page crashes. */
function RouteError() {
  const error = useRouteError() as Error | undefined;
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <Card className="max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-ink-3">{error?.message ?? 'An unexpected error occurred.'}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="rounded-xl border border-line-strong px-4 py-2 text-sm text-ink-2 hover:bg-white/[0.06]" onClick={() => location.reload()}>Reload</button>
          <a className="rounded-xl bg-brand/15 px-4 py-2 text-sm text-brand hover:bg-brand/25" href="/">Go to Overview</a>
        </div>
      </Card>
    </div>
  );
}

const router = createBrowserRouter([
  { element: <PublicOnly />, children: [{ path: '/login', element: <Login /> }] },
  {
    element: <Protected />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/now-playing', element: page(<NowPlaying />, 'now-playing') },
      { path: '/system', element: page(<System />, 'system') },
      { path: '/stats', element: page(<Stats />, 'stats') },
      { path: '/library', element: page(<LibraryHealth />, 'library') },
      { path: '/settings', element: page(<Settings />) },
      { path: '/settings/:section', element: page(<Settings />) },
      { path: '/audit', element: page(<Audit />) },
      { path: '/now-playing/buffering', element: page(<Diagnose />) },
      { path: '/me', element: page(<Me />) },
      { path: '/media/jellyfin/:id', element: page(<JellyfinMedia />) },
      { path: '/media/:type/:id', element: page(<Media />) },
      { path: '/digest', element: page(<Digest />) },
      { path: '/rules', element: page(<Rules />) },
      { path: '/downloads', element: page(<Downloads />, 'downloads') },
      { path: '/jellyfin', element: page(<MediaServer type="jellyfin" />, 'jellyfin') },
      { path: '/emby', element: page(<MediaServer type="emby" />, 'jellyfin') },
      { path: '/plex', element: page(<MediaServer type="plex" />, 'jellyfin') },
      { path: '/sonarr', element: page(<Sonarr />, 'sonarr') },
      { path: '/radarr', element: page(<Radarr />, 'radarr') },
      { path: '/prowlarr', element: page(<Prowlarr />, 'prowlarr') },
      { path: '/seerr', element: page(<Seerr />, 'seerr') },
      { path: '/infinidisk', element: page(<Infinidisk />, 'infinidisk') },
      { path: '/bazarr', element: page(<Bazarr />, 'bazarr') },
      { path: '/lidarr', element: page(<Lidarr />, 'lidarr') },
      { path: '/readarr', element: page(<Readarr />, 'readarr') },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);

export default function App() {
  return (
    <AnimatePresence mode="wait">
      <RouterProvider router={router} />
    </AnimatePresence>
  );
}

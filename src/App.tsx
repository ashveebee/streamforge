import { lazy, Suspense } from 'react';
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

const NowPlaying = lazy(() => import('@/pages/NowPlaying'));
const Jellyfin = lazy(() => import('@/pages/Jellyfin'));
const Sonarr = lazy(() => import('@/pages/Arr').then((m) => ({ default: m.SonarrPage })));
const Radarr = lazy(() => import('@/pages/Arr').then((m) => ({ default: m.RadarrPage })));
const Prowlarr = lazy(() => import('@/pages/Prowlarr'));
const Seerr = lazy(() => import('@/pages/Seerr'));
const Bazarr = lazy(() => import('@/pages/Bazarr'));
const Lidarr = lazy(() => import('@/pages/Music').then((m) => ({ default: m.LidarrPage })));
const Readarr = lazy(() => import('@/pages/Music').then((m) => ({ default: m.ReadarrPage })));
const Infinidisk = lazy(() => import('@/pages/Infinidisk'));
const System = lazy(() => import('@/pages/System'));
const Stats = lazy(() => import('@/pages/Stats'));
const LibraryHealth = lazy(() => import('@/pages/LibraryHealth'));
const Rules = lazy(() => import('@/pages/Rules'));
const Digest = lazy(() => import('@/pages/Digest'));
const Me = lazy(() => import('@/pages/Me'));
const Downloads = lazy(() => import('@/pages/Downloads'));
const Audit = lazy(() => import('@/pages/Audit'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

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
      { path: '/audit', element: page(<Audit />) },
      { path: '/me', element: page(<Me />) },
      { path: '/digest', element: page(<Digest />) },
      { path: '/rules', element: page(<Rules />) },
      { path: '/downloads', element: page(<Downloads />, 'downloads') },
      { path: '/jellyfin', element: page(<Jellyfin />, 'jellyfin') },
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

import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from '@/hooks/useAuth';
import { AppShell } from '@/components/layout/AppShell';
import { LogoMark } from '@/components/layout/Logo';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';

const NowPlaying = lazy(() => import('@/pages/NowPlaying'));
const Jellyfin = lazy(() => import('@/pages/Jellyfin'));
const Sonarr = lazy(() => import('@/pages/Arr').then((m) => ({ default: m.SonarrPage })));
const Radarr = lazy(() => import('@/pages/Arr').then((m) => ({ default: m.RadarrPage })));
const Prowlarr = lazy(() => import('@/pages/Prowlarr'));
const Seerr = lazy(() => import('@/pages/Seerr'));
const Infinidisk = lazy(() => import('@/pages/Infinidisk'));
const System = lazy(() => import('@/pages/System'));
const Stats = lazy(() => import('@/pages/Stats'));
const LibraryHealth = lazy(() => import('@/pages/LibraryHealth'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative">
        <div className="absolute inset-0 animate-pulse rounded-2xl bg-brand/30 blur-2xl" />
        <div className="relative"><LogoMark size={52} /></div>
      </motion.div>
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

const page = (el: React.ReactNode) => <Suspense fallback={<div className="min-h-[60vh]" />}>{el}</Suspense>;

const router = createBrowserRouter([
  { element: <PublicOnly />, children: [{ path: '/login', element: <Login /> }] },
  {
    element: <Protected />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/now-playing', element: page(<NowPlaying />) },
      { path: '/system', element: page(<System />) },
      { path: '/stats', element: page(<Stats />) },
      { path: '/library', element: page(<LibraryHealth />) },
      { path: '/settings', element: page(<Settings />) },
      { path: '/jellyfin', element: page(<Jellyfin />) },
      { path: '/sonarr', element: page(<Sonarr />) },
      { path: '/radarr', element: page(<Radarr />) },
      { path: '/prowlarr', element: page(<Prowlarr />) },
      { path: '/seerr', element: page(<Seerr />) },
      { path: '/infinidisk', element: page(<Infinidisk />) },
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

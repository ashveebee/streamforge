import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Menu } from 'lucide-react';
import { useLocalState } from '@/hooks/useLocalState';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAuth } from '@/hooks/useAuth';
import { jfUserImage } from '@/lib/api';
import { Avatar } from '../ui/Image';
import { Sidebar } from './Sidebar';
import { LogoMark } from './Logo';

export function Ambient() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute -top-[30%] -left-[10%] h-[70vh] w-[60vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgb(139_92_246/0.16),transparent)] blur-3xl" />
      <div className="absolute top-[10%] -right-[15%] h-[60vh] w-[50vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgb(34_211_238/0.09),transparent)] blur-3xl [animation-delay:-8s]" />
      <div className="absolute -bottom-[25%] left-[25%] h-[50vh] w-[50vw] rounded-full bg-[radial-gradient(closest-side,rgb(236_72_153/0.06),transparent)] blur-3xl" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22140%22 height=%22140%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%22.9%22 numOctaves=%223%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22.035%22/></svg>')]" />
    </div>
  );
}

export function AppShell() {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useLocalState('sf:sidebar-collapsed', false);
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => setDrawer(false), [location.pathname]);
  useEffect(() => {
    if (isDesktop) setDrawer(false);
  }, [isDesktop]);

  return (
    <div className="relative min-h-dvh">
      <Ambient />

      {isDesktop ? (
        <div className="fixed inset-y-0 left-0 z-30 p-3">
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </div>
      ) : (
        <>
          <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-x-0 border-t-0 px-4">
            <button
              onClick={() => setDrawer(true)}
              className="-ml-1.5 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white/5"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </button>
            <LogoMark size={26} />
            <span className="text-[15px] font-semibold tracking-tight">StreamForge</span>
            <div className="flex-1" />
            {user && <Avatar src={jfUserImage(user.id, user.imageTag)} name={user.name} size={30} />}
          </header>
          <AnimatePresence>
            {drawer && (
              <>
                <motion.div
                  className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrawer(false)}
                />
                <motion.div
                  className="fixed inset-y-0 left-0 z-50"
                  initial={{ x: -300 }}
                  animate={{ x: 0 }}
                  exit={{ x: -300 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                >
                  <Sidebar collapsed={false} mobile onNavigate={() => setDrawer(false)} />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}

      <main
        className="transition-[padding] duration-300 ease-out-expo"
        style={{ paddingLeft: isDesktop ? (collapsed ? 92 : 272) : 0 }}
      >
        <div className="mx-auto w-full max-w-[1680px] px-4 pt-5 pb-16 sm:px-6 lg:px-8 lg:pt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

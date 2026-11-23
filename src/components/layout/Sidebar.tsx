import { NavLink } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, PlayCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useHealth, useNowPlaying } from '@/hooks/queries';
import { jfUserImage } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ServiceId } from '@/lib/types';
import { Avatar } from '../ui/Image';
import { SERVICES } from '../ui/ServiceIcon';
import { StatusDot } from '../ui/Status';
import { LogoMark } from './Logo';

const SERVICE_ORDER: ServiceId[] = ['jellyfin', 'sonarr', 'radarr', 'prowlarr', 'seerr', 'infinidisk'];

function NavItem({
  to,
  icon: Icon,
  label,
  collapsed,
  trailing,
  color,
  onNavigate,
}: {
  to: string;
  icon: typeof Activity;
  label: string;
  collapsed: boolean;
  trailing?: React.ReactNode;
  color?: string;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center gap-3 rounded-xl px-2.5 text-[13.5px] font-medium transition-colors',
          isActive ? 'text-ink' : 'text-ink-3 hover:bg-white/[0.04] hover:text-ink-2',
          collapsed && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 rounded-xl border border-white/[0.08] bg-gradient-to-r from-white/[0.08] to-white/[0.03]"
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            />
          )}
          <Icon
            className="relative size-[18px] shrink-0 transition-colors"
            style={{ color: isActive ? (color ?? 'var(--color-brand)') : undefined }}
          />
          {!collapsed && <span className="relative flex-1 truncate">{label}</span>}
          {trailing && (
            <span className={cn('relative', collapsed && 'absolute top-1.5 right-1.5')}>{trailing}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
  onNavigate,
  mobile,
}: {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const { user, logout } = useAuth();
  const health = useHealth();
  const playing = useNowPlaying();
  const byId = new Map(health.data?.services.map((s) => [s.id, s]));
  const streams = playing.data?.length ?? 0;

  return (
    <aside
      className={cn(
        'glass flex h-full flex-col rounded-3xl p-3 transition-[width] duration-300 ease-out-expo',
        collapsed ? 'w-[68px]' : 'w-[248px]',
        mobile && 'w-[280px] rounded-l-none',
      )}
    >
      <div className={cn('flex h-11 items-center gap-2.5 px-1.5', collapsed && 'justify-center px-0')}>
        <LogoMark size={30} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">StreamForge</div>
            <div className="text-[11px] text-ink-4">Control centre · v{__APP_VERSION__}</div>
          </div>
        )}
      </div>

      <nav className="mt-5 flex flex-1 flex-col gap-0.5 overflow-y-auto no-scrollbar" aria-label="Main">
        <NavItem to="/" icon={LayoutDashboard} label="Overview" collapsed={collapsed} onNavigate={onNavigate} />
        <NavItem
          to="/now-playing"
          icon={PlayCircle}
          label="Now Playing"
          collapsed={collapsed}
          onNavigate={onNavigate}
          trailing={
            streams > 0 ? (
              collapsed ? (
                <span className="block size-2 rounded-full bg-brand shadow-[0_0_8px_var(--color-brand)]" />
              ) : (
                <span className="rounded-full bg-brand/15 px-1.5 py-px text-[10px] font-semibold text-brand tabular">{streams}</span>
              )
            ) : undefined
          }
        />
        <NavItem to="/system" icon={Activity} label="System Status" collapsed={collapsed} onNavigate={onNavigate} />

        <div className={cn('mt-5 mb-1.5 px-2.5 text-[10.5px] font-semibold tracking-[0.08em] text-ink-4 uppercase', collapsed && 'sr-only')}>
          Services
        </div>
        {collapsed && <div className="mx-auto my-3 h-px w-6 bg-line-strong" />}
        {SERVICE_ORDER.map((id) => {
          const s = byId.get(id);
          const meta = SERVICES[id];
          return (
            <NavItem
              key={id}
              to={meta.path}
              icon={meta.icon}
              label={meta.name}
              color={meta.color}
              collapsed={collapsed}
              onNavigate={onNavigate}
              trailing={s ? <StatusDot status={s.status} size={6} pulse={s.status === 'offline'} /> : undefined}
            />
          );
        })}
      </nav>

      <div className="mt-3 border-t border-line pt-3">
        {user && (
          <div className={cn('flex items-center gap-2.5 rounded-xl p-1.5', collapsed && 'flex-col')}>
            <Avatar src={jfUserImage(user.id, user.imageTag)} name={user.name} size={32} />
            {!collapsed && (
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-[13px] font-medium">{user.name}</div>
                <div className="text-[11px] text-ink-4">{user.isAdmin ? 'Administrator' : 'Member'}</div>
              </div>
            )}
            <button
              onClick={() => void logout()}
              className="grid size-8 place-items-center rounded-lg text-ink-3 transition hover:bg-white/[0.06] hover:text-ink"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn(
              'mt-1 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-xs text-ink-4 transition hover:bg-white/[0.04] hover:text-ink-2',
              collapsed && 'justify-center px-0',
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            <AnimatePresence>{!collapsed && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Collapse</motion.span>}</AnimatePresence>
          </button>
        )}
      </div>
    </aside>
  );
}

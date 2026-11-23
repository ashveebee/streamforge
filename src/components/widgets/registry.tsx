import type { ComponentType } from 'react';
import type { Area, ServiceId } from '@/lib/types';
import { ActivityWidget } from './ActivityWidget';
import { DownloadsWidget } from './DownloadsWidget';
import { IndexersWidget } from './IndexersWidget';
import { LibraryWidget } from './LibraryWidget';
import { NowPlayingHero } from './NowPlayingHero';
import { PlaysWidget } from './PlaysWidget';
import { RecentlyAddedWidget } from './RecentlyAddedWidget';
import { RequestsWidget } from './RequestsWidget';
import { ServiceStatusGrid } from './ServiceStatusGrid';
import { StorageWidget } from './StorageWidget';
import { SystemResourcesWidget } from './SystemResources';
import { UpcomingWidget } from './UpcomingWidget';

export type WidgetSize = 'sm' | 'md' | 'lg' | 'full';
export const SIZES: WidgetSize[] = ['sm', 'md', 'lg', 'full'];
export const SIZE_LABEL: Record<WidgetSize, string> = { sm: '⅓', md: '½', lg: '⅔', full: 'Full' };

/** Grid spans: 1 column on phones, 2 on tablets, 12-col grid on desktop. */
export const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: 'col-span-12 md:col-span-6 xl:col-span-4',
  md: 'col-span-12 md:col-span-6 xl:col-span-6',
  lg: 'col-span-12 xl:col-span-8',
  full: 'col-span-12',
};

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  component: ComponentType;
  defaultSize: WidgetSize;
  /** Widget is only offered when at least one of these services is configured. */
  requires?: ServiceId[];
  /** Area a member needs access to (see Settings → Member access). */
  area?: Area;
}

export const WIDGETS: WidgetDef[] = [
  { id: 'now-playing', title: 'Now playing', description: 'Live streams with artwork and progress', component: NowPlayingHero, defaultSize: 'full', area: 'now-playing' },
  { id: 'services', title: 'Service status', description: 'Health of every integration', component: ServiceStatusGrid, defaultSize: 'full', area: 'system' },
  { id: 'downloads', title: 'Download activity', description: 'Throughput and queue', component: DownloadsWidget, defaultSize: 'lg', requires: ['sonarr', 'radarr'], area: 'system' },
  { id: 'storage', title: 'Storage', description: 'Drives and capacity', component: StorageWidget, defaultSize: 'sm', area: 'system' },
  { id: 'resources', title: 'System resources', description: 'CPU, memory and network', component: () => <SystemResourcesWidget />, defaultSize: 'md', area: 'system' },
  { id: 'plays', title: 'Playback activity', description: 'Plays per day', component: PlaysWidget, defaultSize: 'md', requires: ['jellyfin'] },
  { id: 'upcoming', title: 'Upcoming', description: 'Calendar from Sonarr and Radarr', component: UpcomingWidget, defaultSize: 'sm', requires: ['sonarr', 'radarr'] },
  { id: 'requests', title: 'Requests', description: 'Seerr request summary', component: RequestsWidget, defaultSize: 'sm', requires: ['seerr'] },
  { id: 'library', title: 'Library', description: 'Jellyfin library statistics', component: LibraryWidget, defaultSize: 'sm', requires: ['jellyfin'] },
  { id: 'recent', title: 'Recently added', description: 'Latest additions', component: RecentlyAddedWidget, defaultSize: 'full', requires: ['jellyfin'] },
  { id: 'indexers', title: 'Indexers', description: 'Prowlarr indexer health', component: IndexersWidget, defaultSize: 'md', requires: ['prowlarr'] },
  { id: 'activity', title: 'Server activity', description: 'Jellyfin activity log', component: ActivityWidget, defaultSize: 'md', requires: ['jellyfin'] },
];

export const WIDGET_MAP = new Map(WIDGETS.map((w) => [w.id, w]));

export interface Layout {
  order: string[];
  hidden: string[];
  sizes: Record<string, WidgetSize>;
}

export const DEFAULT_LAYOUT: Layout = {
  order: WIDGETS.map((w) => w.id),
  hidden: [],
  sizes: {},
};

/** Merges a stored layout with the current registry (new widgets appear at the end). */
export function normaliseLayout(l: Layout): Layout {
  const known = new Set(WIDGETS.map((w) => w.id));
  const order = l.order.filter((id) => known.has(id));
  for (const w of WIDGETS) if (!order.includes(w.id)) order.push(w.id);
  return { order, hidden: l.hidden.filter((id) => known.has(id)), sizes: l.sizes ?? {} };
}

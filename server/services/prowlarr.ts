import { config } from '../config.js';
import { cache } from '../lib/cache.js';
import { arrClient } from './arr.js';

export const prowlarr = arrClient('prowlarr', config.prowlarr);

interface Indexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: 'torrent' | 'usenet' | string;
  privacy?: 'public' | 'private' | 'semiPrivate' | string;
  priority?: number;
  implementationName?: string;
  added?: string;
}
interface IndexerStatus {
  indexerId: number;
  disabledTill?: string;
  mostRecentFailure?: string;
  initialFailure?: string;
}
interface IndexerStats {
  indexers: {
    indexerId: number;
    indexerName: string;
    averageResponseTime: number;
    numberOfQueries: number;
    numberOfGrabs: number;
    numberOfRssQueries: number;
    numberOfAuthQueries: number;
    numberOfFailedQueries: number;
    numberOfFailedGrabs: number;
    numberOfFailedRssQueries?: number;
    numberOfFailedAuthQueries?: number;
  }[];
}
interface Application {
  id: number;
  name: string;
  implementationName?: string;
  syncLevel?: string;
}

export async function prowlarrOverview() {
  const c = prowlarr!;
  const [indexers, statuses, stats, apps] = await Promise.all([
    cache.get('prowlarr:indexers', 30_000, () => c.get<Indexer[]>('/api/v1/indexer')),
    cache.get('prowlarr:status', 30_000, () => c.get<IndexerStatus[]>('/api/v1/indexerstatus')),
    cache.get('prowlarr:stats', 60_000, () => c.get<IndexerStats>('/api/v1/indexerstats')),
    cache.get('prowlarr:apps', 5 * 60_000, () => c.get<Application[]>('/api/v1/applications').catch(() => [])),
  ]);

  const statusById = new Map(statuses.map((s) => [s.indexerId, s]));
  const statsById = new Map(stats.indexers.map((s) => [s.indexerId, s]));
  const now = Date.now();

  const list = indexers.map((i) => {
    const st = statusById.get(i.id);
    const s = statsById.get(i.id);
    const disabledUntil = st?.disabledTill && Date.parse(st.disabledTill) > now ? st.disabledTill : undefined;
    const queries = s?.numberOfQueries ?? 0;
    const failed = s?.numberOfFailedQueries ?? 0;
    return {
      id: i.id,
      name: i.name,
      enabled: i.enable,
      protocol: i.protocol,
      privacy: i.privacy,
      priority: i.priority,
      implementation: i.implementationName,
      health: !i.enable ? 'disabled' : disabledUntil ? 'failing' : 'healthy',
      disabledUntil,
      lastFailure: st?.mostRecentFailure,
      stats: {
        avgResponseMs: s?.averageResponseTime ?? 0,
        queries,
        grabs: s?.numberOfGrabs ?? 0,
        rssQueries: s?.numberOfRssQueries ?? 0,
        authQueries: s?.numberOfAuthQueries ?? 0,
        failedQueries: failed,
        failedGrabs: s?.numberOfFailedGrabs ?? 0,
        successRate: queries > 0 ? (queries - failed) / queries : undefined,
      },
    };
  });

  const totals = list.reduce(
    (a, i) => {
      a.queries += i.stats.queries;
      a.grabs += i.stats.grabs;
      a.failedQueries += i.stats.failedQueries;
      a.failedGrabs += i.stats.failedGrabs;
      return a;
    },
    { queries: 0, grabs: 0, failedQueries: 0, failedGrabs: 0 },
  );
  const responders = list.filter((i) => i.stats.avgResponseMs > 0);

  return {
    summary: {
      total: list.length,
      enabled: list.filter((i) => i.enabled).length,
      healthy: list.filter((i) => i.health === 'healthy').length,
      failing: list.filter((i) => i.health === 'failing').length,
      disabled: list.filter((i) => i.health === 'disabled').length,
      torrent: list.filter((i) => i.protocol === 'torrent').length,
      usenet: list.filter((i) => i.protocol === 'usenet').length,
      avgResponseMs: responders.length
        ? Math.round(responders.reduce((a, i) => a + i.stats.avgResponseMs, 0) / responders.length)
        : 0,
      ...totals,
    },
    indexers: list.sort((a, b) => b.stats.queries - a.stats.queries),
    applications: apps.map((a) => ({ id: a.id, name: a.name, type: a.implementationName, syncLevel: a.syncLevel })),
  };
}

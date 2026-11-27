import { CircleAlert, History, Info, LogIn, Play, Square, TriangleAlert } from 'lucide-react';
import { useActivity, useMainServer } from '@/hooks/queries';
import { relative } from '@/lib/format';
import type { MediaServerType } from '@/lib/types';
import { MEDIA_SERVERS } from '../ui/ServiceIcon';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState, QueryState, SkeletonRows } from '../ui/States';
import { t } from '@/i18n';

function iconFor(type: string, severity: string) {
  if (severity === 'Error') return { Icon: CircleAlert, cls: 'text-bad' };
  if (severity === 'Warning') return { Icon: TriangleAlert, cls: 'text-warn' };
  if (/PlaybackStart|VideoPlayback$|AudioPlayback$/.test(type)) return { Icon: Play, cls: 'text-brand' };
  if (/PlaybackStop/.test(type)) return { Icon: Square, cls: 'text-ink-3' };
  if (/Session|Authentication/.test(type)) return { Icon: LogIn, cls: 'text-brand-2' };
  return { Icon: Info, cls: 'text-ink-3' };
}

/** `server` picks an extra media server; the main one by default. */
export function ActivityWidget({ limit = 8, server, serverType: given }: { limit?: number; server?: string; serverType?: MediaServerType }) {
  const main = useMainServer();
  const serverType = given ?? main.type;
  const q = useActivity(server);
  return (
    <Card className="h-full">
      <CardHeader icon={History} accent={MEDIA_SERVERS[serverType].color} title={t('dashboard.widgets.activity')} subtitle={serverType === 'plex' ? t('widgets.activity.plex') : serverType === 'silo' ? t('widgets.activity.silo') : t('widgets.activity.log', { server: serverType === 'emby' ? 'Emby' : 'Jellyfin' })} />
      <CardBody>
        <QueryState
          query={q}
          skeleton={<SkeletonRows rows={5} />}
          isEmpty={(d) => !d.length}
          empty={<EmptyState icon={History} title={t('widgets.activity.none')} />}
        >
          {(items) => (
            <ol className="relative space-y-0.5 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-line">
              {items.slice(0, limit).map((a) => {
                const { Icon, cls } = iconFor(a.type, a.severity);
                return (
                  <li key={a.id} className="relative flex gap-3 py-1.5">
                    <span className="relative z-10 grid size-[27px] shrink-0 place-items-center rounded-full border border-line bg-surface">
                      <Icon className={`size-3.5 ${cls}`} />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="line-clamp-2 text-[13px] leading-snug text-ink-2">{a.name}</div>
                      <div className="text-[11px] text-ink-4">{relative(a.date)}{a.overview ? ` · ${a.overview}` : ''}</div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </QueryState>
      </CardBody>
    </Card>
  );
}

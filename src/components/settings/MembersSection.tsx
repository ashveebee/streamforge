import { Users } from 'lucide-react';
import { useMainServer, useMemberAccess, useSaveMemberAccess } from '@/hooks/queries';
import { cn } from '@/lib/cn';
import type { Area } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { t, type MessageKey } from '@/i18n';

const NAMES: Partial<Record<Area, string>> = { jellyfin: 'Jellyfin', sonarr: 'Sonarr', radarr: 'Radarr', prowlarr: 'Prowlarr', infinidisk: 'Infinidisk', bazarr: 'Bazarr', lidarr: 'Lidarr', readarr: 'Readarr', audiobookshelf: 'Audiobookshelf' };
const KEYS: Partial<Record<Area, MessageKey>> = {
  'now-playing': 'nav.nowPlaying',
  stats: 'nav.stats',
  library: 'nav.libraryHealth',
  system: 'nav.systemStatus',
  seerr: 'sec.members.seerr',
  downloads: 'settings.tabs.downloads.label',
  requests: 'sec.members.requests',
};
const label = (a: Area) => NAMES[a] ?? (KEYS[a] ? t(KEYS[a]) : a);

/** Whether non-admin Jellyfin users can sign in, and which pages they see. */
export function MembersSection() {
  const main = useMainServer();
  const q = useMemberAccess();
  const save = useSaveMemberAccess();
  const d = q.data;
  if (!d) return null;
  const toggle = (a: Area) => save.mutate({ areas: d.areas.includes(a) ? d.areas.filter((x) => x !== a) : [...d.areas, a] });
  return (
    <section className="mt-8" aria-labelledby="members-h">
      <h2 id="members-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight"><Users className="size-4 text-brand" /> {t('sec.members.title')}</h2>
      <p className="mb-3 text-xs text-ink-3">{t('sec.members.intro')}</p>
      <Card>
        <div className="divide-y divide-line">
          <div className="flex items-center gap-3 px-5 py-4">
            <div className="flex-1">
              <div className="text-[13px] font-medium">{main.plex ? t('sec.members.plex') : t('sec.members.signIn', { server: main.name })}</div>
              <div className="text-[11px] text-ink-4">{t('sec.members.off')}</div>
            </div>
            <Switch checked={d.signIn} disabled={save.isPending} onChange={(v) => save.mutate({ signIn: v })} label={t('sec.members.allow')} />
          </div>
          <div className={cn('px-5 py-4', !d.signIn && 'opacity-50')}>
            <div className="mb-2 text-xs font-medium text-ink-2">{t('sec.members.pages')}</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('sec.members.pages')}>
              {d.available.map((a) => {
                const on = d.areas.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    disabled={!d.signIn || save.isPending}
                    onClick={() => toggle(a)}
                    className={cn('rounded-lg border px-2.5 py-1 text-xs transition', on ? 'border-brand/40 bg-brand/10 text-ink' : 'border-line text-ink-4 hover:text-ink-2')}
                  >
                    {label(a)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-4">{t('sec.members.overview')}</p>
            {save.error && <p className="mt-2 text-xs text-bad">{(save.error as Error).message}</p>}
          </div>
        </div>
      </Card>
    </section>
  );
}

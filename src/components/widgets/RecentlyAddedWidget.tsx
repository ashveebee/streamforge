import { useRef } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-react';
import { useLatest, useMainServer } from '@/hooks/queries';
import { jfImage } from '@/lib/api';
import { relative } from '@/lib/format';
import { Card, CardHeader } from '../ui/Card';
import { FadeImage } from '../ui/Image';
import { QueryState, Skeleton } from '../ui/States';
import { EmptyState } from '../ui/States';
import { TitleLink } from '@/components/ui/TitleLink';
import { MEDIA_SERVERS } from '@/components/ui/ServiceIcon';
import type { MediaServerType } from '@/lib/types';

/** `server` picks an extra media server; the main one by default. */
export function RecentlyAddedWidget({ server, serverType: given }: { server?: string; serverType?: MediaServerType } = {}) {
  const main = useMainServer();
  const serverType = given ?? main.type;
  const q = useLatest(server);
  // Title pages read the main Jellyfin server, so other servers' titles don't link.
  const linkTo = (id: string) => ((server && server !== 'jellyfin') || main.other ? undefined : `/media/jellyfin/${id}`);
  const scroller = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <Card className="h-full">
      <CardHeader
        icon={Sparkles}
        accent={MEDIA_SERVERS[serverType].color}
        title="Recently added"
        subtitle={`Fresh in your ${MEDIA_SERVERS[serverType].name} libraries`}
        action={
          <div className="flex gap-1">
            <button onClick={() => scroll(-1)} className="grid size-8 place-items-center rounded-lg border border-line text-ink-3 transition hover:bg-white/5 hover:text-ink" aria-label="Scroll left"><ChevronLeft className="size-4" /></button>
            <button onClick={() => scroll(1)} className="grid size-8 place-items-center rounded-lg border border-line text-ink-3 transition hover:bg-white/5 hover:text-ink" aria-label="Scroll right"><ChevronRight className="size-4" /></button>
          </div>
        }
      />
      <QueryState
        query={q}
        className="px-5 pb-5"
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Sparkles} title="Nothing new yet" />}
        skeleton={<div className="flex gap-4 overflow-hidden px-5 pb-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[2/3] w-36 shrink-0 rounded-xl" />)}</div>}
      >
        {(items) => (
          <div ref={scroller} className="flex snap-x scroll-px-5 gap-4 overflow-x-auto scroll-smooth px-5 pb-5 no-scrollbar">
            {items.map((i, idx) => (
              <motion.div
                key={i.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx, 10) * 0.03 }}
                className="group w-32 shrink-0 snap-start sm:w-36"
              >
                <TitleLink to={linkTo(i.id)} className="relative block">
                  <FadeImage
                    src={jfImage(i.poster, 320)}
                    alt={i.title}
                    className="aspect-[2/3] rounded-xl ring-1 ring-white/10 transition duration-500 ease-out-expo group-hover:-translate-y-1 group-hover:shadow-[0_20px_40px_-16px_rgb(0_0_0/0.9)] group-hover:ring-white/25"
                    imgClassName="group-hover:scale-105 transition-transform duration-700"
                  />
                  {i.rating !== undefined && (
                    <span className="glass absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
                      <Star className="size-2.5 fill-warn text-warn" />
                      {i.rating.toFixed(1)}
                    </span>
                  )}
                </TitleLink>
                <TitleLink to={linkTo(i.id)} className="mt-2 block truncate text-[13px] font-medium">{i.title}</TitleLink>
                <div className="truncate text-[11px] text-ink-3">{i.subtitle ?? i.year ?? ''}</div>
                <div className="text-[11px] text-ink-4">{relative(i.added)}</div>
              </motion.div>
            ))}
          </div>
        )}
      </QueryState>
    </Card>
  );
}

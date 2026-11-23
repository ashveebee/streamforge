import type { ArrInstance } from './instances.js';
import type { QueueItem } from './types.js';

/*
 * The download sampler polls every Sonarr/Radarr queue every few seconds.
 * Features that react to queue changes (auto-import, stalled cleanup,
 * notifications) subscribe here instead of polling again themselves.
 */

type Handler = (inst: ArrInstance, items: QueueItem[]) => void;
const handlers = new Set<Handler>();

export function watchQueues(fn: Handler) {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

export function onQueueSample(inst: ArrInstance, items: QueueItem[]) {
  for (const fn of handlers) {
    try {
      fn(inst, items);
    } catch (err) {
      console.warn('[queue-watch]', (err as Error).message);
    }
  }
}

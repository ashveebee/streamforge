/*
 * Notification events. Delivery channels are added in a later step; for now
 * events are only logged.
 */

export type EventType =
  | 'service_down'
  | 'service_up'
  | 'disk_low'
  | 'import_done'
  | 'import_failed'
  | 'download_removed'
  | 'request_pending';

export interface EventPayload {
  title: string;
  message: string;
  /** App path to open, e.g. `/sonarr`. */
  url?: string;
}

export function emit(type: EventType, payload: EventPayload) {
  console.log(`[notify] ${type}: ${payload.title}`);
}

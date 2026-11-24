import { buildUrl, requestJson } from '../lib/http.js';
import { cache } from '../lib/cache.js';
import { authHeader, base, jf, serverToken, type JfCtx } from './jellyfin.js';

/* Jellyfin scheduled tasks and library scans. All of these need an administrator. */

interface JfTask {
  Id: string;
  Name: string;
  Key?: string;
  Category: string;
  Description?: string;
  State: 'Idle' | 'Running' | 'Cancelling';
  CurrentProgressPercentage?: number;
  IsHidden?: boolean;
  LastExecutionResult?: { StartTimeUtc?: string; EndTimeUtc?: string; Status?: string; ErrorMessage?: string };
  Triggers?: { Type: string; IntervalTicks?: number; TimeOfDayTicks?: number; DayOfWeek?: string }[];
}

const TICKS_PER_MS = 10_000;

function describeTrigger(t: NonNullable<JfTask['Triggers']>[number]) {
  const hhmm = (ticks?: number) => {
    if (ticks === undefined) return '';
    const m = Math.round(ticks / TICKS_PER_MS / 60_000);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  switch (t.Type) {
    case 'IntervalTrigger': {
      const h = (t.IntervalTicks ?? 0) / TICKS_PER_MS / 3_600_000;
      return h >= 24 ? `Every ${Math.round(h / 24)} day${h >= 48 ? 's' : ''}` : h >= 1 ? `Every ${Math.round(h)} hour${h >= 2 ? 's' : ''}` : `Every ${Math.round(h * 60)} minutes`;
    }
    case 'DailyTrigger':
      return `Daily at ${hhmm(t.TimeOfDayTicks)}`;
    case 'WeeklyTrigger':
      return `${t.DayOfWeek}s at ${hhmm(t.TimeOfDayTicks)}`;
    case 'StartupTrigger':
      return 'On startup';
    default:
      return t.Type.replace(/Trigger$/, '');
  }
}

export async function scheduledTasks(ctx: JfCtx) {
  const tasks = await jf<JfTask[]>('/ScheduledTasks', serverToken(ctx), ctx.deviceId, { isHidden: false });
  return tasks
    .map((t) => ({
      id: t.Id,
      key: t.Key,
      name: t.Name,
      category: t.Category,
      description: t.Description,
      state: t.State,
      progress: t.CurrentProgressPercentage !== undefined ? t.CurrentProgressPercentage / 100 : undefined,
      last: t.LastExecutionResult?.EndTimeUtc
        ? {
            startedAt: t.LastExecutionResult.StartTimeUtc,
            endedAt: t.LastExecutionResult.EndTimeUtc,
            status: t.LastExecutionResult.Status,
            error: t.LastExecutionResult.ErrorMessage,
          }
        : undefined,
      schedule: (t.Triggers ?? []).map(describeTrigger),
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export const TASK_ID_RE = /^[a-f0-9]{32}$/i;

async function post(ctx: JfCtx, path: string, method = 'POST', query?: Record<string, string | boolean>) {
  await requestJson(buildUrl(base(), path, query), { method, headers: authHeader(serverToken(ctx), ctx.deviceId), service: 'jellyfin' });
}

export const startTask = (ctx: JfCtx, id: string) => post(ctx, `/ScheduledTasks/Running/${id}`);
export const stopTask = (ctx: JfCtx, id: string) => post(ctx, `/ScheduledTasks/Running/${id}`, 'DELETE');

/** Scans every library for new and removed files. */
export async function scanAll(ctx: JfCtx) {
  await post(ctx, '/Library/Refresh');
  cache.delete('jf:libraries:');
}

/** Scans one library; `full` also refreshes all metadata and images. */
export async function scanLibrary(ctx: JfCtx, id: string, full: boolean) {
  await post(ctx, `/Items/${id}/Refresh`, 'POST', {
    Recursive: true,
    MetadataRefreshMode: full ? 'FullRefresh' : 'Default',
    ImageRefreshMode: full ? 'FullRefresh' : 'Default',
    ReplaceAllMetadata: full,
    ReplaceAllImages: false,
  });
  cache.delete('jf:libraries:');
}

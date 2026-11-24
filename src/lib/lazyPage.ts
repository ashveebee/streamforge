import { lazy, type ComponentType } from 'react';

const KEY = 'sf:chunk-reload';

/**
 * After StreamForge is upgraded, an open tab still points at the previous
 * build's page files, which no longer exist. Reload once to pick up the new
 * build instead of leaving the page blank; the guard stops reload loops.
 */
export function reloadForNewBuild() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    // Storage unavailable: still reload, the timestamp check below can't loop forever anyway.
  }
  if (Date.now() - last < 15_000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // ignore
  }
  location.reload();
  return true;
}

/** React.lazy that retries once, then reloads the app if the file is gone. */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await load();
      } catch (err) {
        if (reloadForNewBuild()) return new Promise<{ default: T }>(() => {});
        throw err;
      }
    }
  });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The input field a validation error refers to, when the server says. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get notConfigured() {
    return this.code === 'not_configured';
  }
  get unauthenticated() {
    return this.status === 401;
  }
}

type Listener = () => void;
const unauthListeners = new Set<Listener>();
/** Lets the auth provider react when any request discovers the session ended. */
export const onUnauthenticated = (fn: Listener) => {
  unauthListeners.add(fn);
  return () => {
    unauthListeners.delete(fn);
  };
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      signal: init.signal,
      headers: {
        Accept: 'application/json',
        'X-StreamForge': '1',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the StreamForge server', 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/mfa')) unauthListeners.forEach((fn) => fn());
    throw new ApiError(data.message ?? res.statusText, res.status, data.error, data.field);
  }
  return data as T;
}

/** Image proxy helpers — artwork never comes from upstream services directly. */
export interface ArtworkRef {
  itemId: string;
  type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo';
  tag?: string;
  /** Set when the artwork lives on an extra Jellyfin server. */
  server?: string;
}

export function jfImage(ref: ArtworkRef | undefined, width: number) {
  if (!ref) return undefined;
  const q = new URLSearchParams({ w: String(width) });
  if (ref.tag) q.set('tag', ref.tag);
  if (ref.server) q.set('server', ref.server);
  return `/api/jellyfin/image/items/${ref.itemId}/${ref.type}?${q}`;
}

/** A user's avatar; pass `server` for a user on an extra Jellyfin server. */
export function jfUserImage(userId: string | undefined, tag: string | undefined, width = 96, server?: string) {
  if (!userId || !tag) return undefined;
  return `/api/jellyfin/image/users/${userId}?w=${width}&tag=${encodeURIComponent(tag)}${server ? `&server=${encodeURIComponent(server)}` : ''}`;
}

interface Entry<T> {
  value?: T;
  expires: number;
  pending?: Promise<T>;
}

/**
 * Tiny TTL cache with in-flight de-duplication, so that many dashboard
 * clients polling at once only produce one upstream request per key.
 */
export class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (hit?.value !== undefined && hit.expires > now) return hit.value;
    if (hit?.pending) return hit.pending;

    const pending = loader()
      .then((value) => {
        this.store.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      })
      .catch((err) => {
        this.store.delete(key);
        throw err;
      });
    this.store.set(key, { ...hit, expires: hit?.expires ?? 0, pending });
    return pending;
  }

  delete(prefix: string) {
    for (const key of this.store.keys()) if (key.startsWith(prefix)) this.store.delete(key);
  }
}

export const cache = new TtlCache();

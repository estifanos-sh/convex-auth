/**
 * Simple TTL cache with capacity eviction.
 *
 * @module
 */

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
};

type CacheOptions<K, V> = {
  /** Maximum number of entries before the oldest is evicted. */
  capacity: number;
  /** Time-to-live in milliseconds. */
  timeToLiveMs: number;
  /** Factory function called on cache miss. */
  lookup: (key: K) => V;
};

type Cache<K, V> = {
  get: (key: K) => V;
  invalidate: (key: K) => void;
  clear: () => void;
};

/**
 * Create a synchronous TTL cache.
 *
 * ```ts
 * const jwksCache = createCache({
 *   capacity: 128,
 *   timeToLiveMs: 60 * 60 * 1000,
 *   lookup: (url) => createRemoteJWKSet(new URL(url)),
 * });
 * const jwks = jwksCache.get(url);
 * ```
 */
export function createCache<K, V>(opts: CacheOptions<K, V>): Cache<K, V> {
  const { capacity, timeToLiveMs, lookup } = opts;
  const store = new Map<K, CacheEntry<V>>();

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  function evictOldest() {
    if (store.size < capacity) return;
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) {
      store.delete(firstKey);
    }
  }

  return {
    get(key: K): V {
      const existing = store.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        return existing.value;
      }
      if (existing) store.delete(key);
      evictExpired();
      evictOldest();

      const value = lookup(key);
      store.set(key, { value, expiresAt: Date.now() + timeToLiveMs });
      return value;
    },

    invalidate(key: K) {
      store.delete(key);
    },

    clear() {
      store.clear();
    },
  };
}

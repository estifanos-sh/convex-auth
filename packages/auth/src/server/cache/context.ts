/**
 * Per-execution cache for Convex auth component reads.
 *
 * Convex components are invoked across a function boundary — every
 * `auth.user.get`, `auth.member.get`, `getGroupConnection`, etc. is
 * `ctx.runQuery(components.auth.…)`. Each crossing costs ~10–30ms.
 * Inside a single handler we often fetch the same entity several times
 * (outer `auth.ctx()` resolver + inner `auth.member.assert` calls +
 * Connection admin authorizer target resolution + the handler body itself).
 *
 * This module attaches a `Map<string, Promise<unknown>>` to the ctx via
 * a Symbol so that concurrent and repeated reads of the same key within
 * a single function invocation share one component round-trip. The cache
 * lives for the lifetime of the ctx object and dies with it.
 *
 * Semantics:
 * - Keys are namespaced strings (`user:abc`, `group:xyz`, etc.).
 * - Promises are stored — two concurrent callers dedup correctly.
 * - Rejected promises are evicted so a retry can succeed.
 * - Writes do **not** automatically invalidate reads; this matches the
 *   Convex transactional model where a mutation sees its own writes only
 *   on subsequent calls. If a handler writes and then re-reads an entity
 *   expecting fresh data, it must call {@link invalidateCtxCache} with the
 *   appropriate key (or key prefix).
 *
 * @module
 * @internal
 */

const CACHE_SYMBOL = Symbol.for("@estifanos-sh/convex-auth/ctxCache");

/** @internal */
export type CtxCacheStore = Map<string, Promise<unknown>>;

type Cached = { [CACHE_SYMBOL]?: CtxCacheStore };

/**
 * Get (or lazily create) the cache store attached to a Convex ctx.
 * @internal
 */
export function getCtxCache(ctx: unknown): CtxCacheStore {
  const c = ctx as Cached;
  let store = c[CACHE_SYMBOL];
  if (store === undefined) {
    store = new Map();
    c[CACHE_SYMBOL] = store;
  }
  return store;
}

/**
 * Check whether the ctx cache already holds an entry under `key`.
 *
 * Useful before a batched fetch: callers can short-circuit the RPC if every
 * needed ID is already cached, or compute the exact subset to request.
 *
 * @internal
 */
export function ctxCacheHas(ctx: unknown, key: string): boolean {
  return getCtxCache(ctx).has(key);
}

/**
 * Memoize an async read against the ctx cache.
 *
 * The returned promise is cached under `key`; concurrent callers get the
 * same in-flight promise. If the promise rejects, the entry is removed so a
 * later retry can succeed.
 *
 * @internal
 */
export function cached<T>(ctx: unknown, key: string, fn: () => Promise<T>): Promise<T> {
  const store = getCtxCache(ctx);
  const hit = store.get(key);
  if (hit !== undefined) return hit as Promise<T>;
  const promise = fn().catch((err) => {
    if (store.get(key) === promise) {
      store.delete(key);
    }
    throw err;
  });
  store.set(key, promise);
  return promise;
}

/**
 * Drop a single cache entry (or all entries matching a prefix).
 *
 * Use this from mutations that write to an entity the cache already holds.
 * Passing no prefix clears the entire cache.
 *
 * @internal
 */
export function invalidateCtxCache(ctx: unknown, keyPrefix?: string): void {
  const store = getCtxCache(ctx);
  if (keyPrefix === undefined || keyPrefix === "") {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key === keyPrefix || key.startsWith(`${keyPrefix}:`)) {
      store.delete(key);
    }
  }
}

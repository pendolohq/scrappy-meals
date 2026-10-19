/**
 * In-memory fixed-window limiter. Fine for a single app instance; counters
 * reset on restart, which only ever makes it more lenient.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Records an attempt; returns false once `key` is over the limit for this window. */
    hit(key: string): boolean {
      const t = now();
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        if (hits.size > 10_000) {
          for (const [k, v] of hits) {
            if (v.resetAt <= t) {
              hits.delete(k);
            }
          }
        }
        hits.set(key, { count: 1, resetAt: t + opts.windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= opts.limit;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}

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
    /** Takes back one attempt recorded by `hit` in this window. */
    undo(key: string) {
      const entry = hits.get(key);
      if (entry && entry.resetAt > now()) {
        entry.count -= 1;
      }
    },
    /** Whether `key` is already at the limit for this window (records nothing). */
    blocked(key: string): boolean {
      const entry = hits.get(key);
      return !!entry && entry.resetAt > now() && entry.count >= opts.limit;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Sign-in limits, counting failed attempts only, per 15 minutes: 30 per IP,
 * 10 per email from one IP, and 50 per email overall. Someone who knows a
 * member's email can't lock them out from their own device: that takes 50
 * failures, from at least 5 IP addresses.
 *
 * `attempt` counts before the (slow) password check and `succeeded` gives it
 * back, so a burst of simultaneous requests can't all pass `allowed`.
 */
export function createSignInLimits(now?: () => number) {
  const perIp = createRateLimiter({ limit: 30, windowMs: WINDOW_MS, now });
  const perPair = createRateLimiter({ limit: 10, windowMs: WINDOW_MS, now });
  const perEmail = createRateLimiter({ limit: 50, windowMs: WINDOW_MS, now });
  const pair = (email: string, ip: string) => `${email}|${ip}`;
  return {
    allowed(email: string, ip: string): boolean {
      return !(
        perIp.blocked(ip) ||
        perPair.blocked(pair(email, ip)) ||
        perEmail.blocked(email)
      );
    },
    attempt(email: string, ip: string): void {
      perIp.hit(ip);
      perPair.hit(pair(email, ip));
      perEmail.hit(email);
    },
    succeeded(email: string, ip: string): void {
      perIp.undo(ip);
      perEmail.undo(email);
      perPair.reset(pair(email, ip));
    },
  };
}

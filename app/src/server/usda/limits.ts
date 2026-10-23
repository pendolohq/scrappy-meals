import "server-only";

import { UserFacingError } from "../errors";
import { createRateLimiter } from "../rate-limit";

const PER_HOUR = 120;

/**
 * Hand searches and confirmations each call USDA, whose key allows about
 * 1,000 requests an hour for the whole household, so one person can't use it up.
 */
export function createUsdaLimits(now?: () => number) {
  const opts = { limit: PER_HOUR, windowMs: 60 * 60 * 1000, now };
  const search = createRateLimiter(opts);
  const confirm = createRateLimiter(opts);
  const take = (limiter: typeof search, userId: string, what: string) => {
    if (!limiter.hit(userId)) {
      throw new UserFacingError(`Too many ${what}. Try again in a while.`);
    }
  };
  return {
    search: (userId: string) => take(search, userId, "USDA searches"),
    confirm: (userId: string) => take(confirm, userId, "matches saved"),
  };
}

export const usdaLimits = createUsdaLimits();

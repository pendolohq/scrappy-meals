import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then blocks until it resets", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect([rl.hit("a"), rl.hit("a"), rl.hit("a"), rl.hit("a")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(rl.hit("b")).toBe(true);
    t = 1000;
    expect(rl.hit("a")).toBe(true);
  });

  it("reset clears a key", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    rl.hit("a");
    expect(rl.hit("a")).toBe(false);
    rl.reset("a");
    expect(rl.hit("a")).toBe(true);
  });
});

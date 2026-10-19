import { describe, expect, it } from "vitest";

import { createRateLimiter, createSignInLimits } from "./rate-limit";

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

describe("createSignInLimits", () => {
  const fail = (
    limits: ReturnType<typeof createSignInLimits>,
    email: string,
    ip: string,
    times: number
  ) => {
    for (let i = 0; i < times; i++) {
      limits.failed(email, ip);
    }
  };

  it("someone guessing a member's password doesn't lock the member out", () => {
    const limits = createSignInLimits(() => 0);
    fail(limits, "alex@example.test", "6.6.6.6", 10);
    expect(limits.allowed("alex@example.test", "6.6.6.6")).toBe(false);
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(true);
  });

  it("caps one email overall, and one IP across emails", () => {
    const limits = createSignInLimits(() => 0);
    for (let n = 0; n < 5; n++) {
      fail(limits, "alex@example.test", `6.6.6.${n}`, 10);
    }
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(false);

    for (let n = 0; n < 30; n++) {
      limits.failed(`guess${n}@example.test`, "7.7.7.7");
    }
    expect(limits.allowed("sam@example.test", "7.7.7.7")).toBe(false);
  });

  it("doesn't count successful sign-ins", () => {
    const limits = createSignInLimits(() => 0);
    fail(limits, "alex@example.test", "1.2.3.4", 9);
    limits.succeeded("alex@example.test", "1.2.3.4");
    fail(limits, "alex@example.test", "1.2.3.4", 9);
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(true);
  });

  it("lets everyone in again after the window", () => {
    let t = 0;
    const limits = createSignInLimits(() => t);
    fail(limits, "alex@example.test", "1.2.3.4", 10);
    t = 15 * 60 * 1000;
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(true);
  });
});

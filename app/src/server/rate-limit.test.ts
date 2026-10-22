import { describe, expect, it } from "vitest";

import { createRateLimiter, createSignInLimits, ipBucket } from "./rate-limit";

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

describe("ipBucket", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(ipBucket("1.2.3.4")).toBe("1.2.3.4");
    expect(ipBucket("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipBucket("unknown")).toBe("unknown");
  });

  it("groups IPv6 addresses by their /64, which one subscriber usually has", () => {
    const a = ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(ipBucket("2001:DB8:1:2::1")).toBe(a);
    expect(ipBucket("2001:db8:1:3::1")).not.toBe(a);
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
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
      limits.attempt(email, ip);
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
      limits.attempt(`guess${n}@example.test`, "7.7.7.7");
    }
    expect(limits.allowed("sam@example.test", "7.7.7.7")).toBe(false);
  });

  it("doesn't count successful sign-ins", () => {
    const limits = createSignInLimits(() => 0);
    // A household behind one IP signing in often: never blocked.
    for (let n = 0; n < 40; n++) {
      limits.attempt(`member${n % 2}@example.test`, "1.2.3.4");
      limits.succeeded(`member${n % 2}@example.test`, "1.2.3.4");
    }
    fail(limits, "alex@example.test", "1.2.3.4", 9);
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(true);
  });

  it("counts an attempt before its password is checked", () => {
    const limits = createSignInLimits(() => 0);
    // Ten requests sent at once: each is counted as it passes the check.
    const passed = Array.from({ length: 12 }, () => {
      const ok = limits.allowed("alex@example.test", "6.6.6.6");
      if (ok) {
        limits.attempt("alex@example.test", "6.6.6.6");
      }
      return ok;
    });
    expect(passed.filter(Boolean)).toHaveLength(10);
  });

  it("lets a member's known device past the per-email cap", () => {
    const limits = createSignInLimits(() => 0);
    for (let n = 0; n < 5; n++) {
      fail(limits, "alex@example.test", `6.6.6.${n}`, 10);
    }
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(false);
    expect(limits.allowed("alex@example.test", "1.2.3.4", true)).toBe(true);
    // Still limited from one address, known device or not.
    expect(limits.allowed("alex@example.test", "6.6.6.0", true)).toBe(false);
  });

  it("lets everyone in again after the window", () => {
    let t = 0;
    const limits = createSignInLimits(() => t);
    fail(limits, "alex@example.test", "1.2.3.4", 10);
    t = 15 * 60 * 1000;
    expect(limits.allowed("alex@example.test", "1.2.3.4")).toBe(true);
  });
});

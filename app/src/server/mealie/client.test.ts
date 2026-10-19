import { describe, expect, it } from "vitest";

import {
  createMealieClient,
  isMealieUnavailable,
  MealieError,
  MealieUnavailableError,
  unwrap,
} from "./client";

const clientWith = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createMealieClient({
    baseUrl: "http://mealie",
    token: "t",
    fetch,
    timeoutMs,
  });

const about = async (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  unwrap(await clientWith(fetch, timeoutMs).GET("/api/app/about"));

describe("Mealie unavailable", () => {
  it("wraps a refused connection", async () => {
    const refused = new TypeError("fetch failed");
    const err = await about(() => Promise.reject(refused)).catch((e) => e);
    expect(err).toBeInstanceOf(MealieUnavailableError);
    expect(err.cause).toBe(refused);
    expect(isMealieUnavailable(err)).toBe(true);
  });

  it("wraps a timeout", async () => {
    const hang = (req: Request) =>
      new Promise<Response>((_, reject) =>
        req.signal.addEventListener("abort", () => reject(req.signal.reason))
      );
    const err = await about(hang as typeof fetch, 10).catch((e) => e);
    expect(isMealieUnavailable(err)).toBe(true);
  });

  it("counts 5xx and 429 as unavailable, other errors not", async () => {
    const status = (code: number) => () =>
      Promise.resolve(new Response("{}", { status: code }));
    for (const [code, down] of [
      [503, true],
      [429, true],
      [404, false],
      [401, false],
    ] as const) {
      const err = await about(status(code)).catch((e) => e);
      expect(err).toBeInstanceOf(MealieError);
      expect(isMealieUnavailable(err)).toBe(down);
    }
  });

  it("doesn't count our own bugs", () => {
    expect(isMealieUnavailable(new TypeError("x is undefined"))).toBe(false);
  });
});

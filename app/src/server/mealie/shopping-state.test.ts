import { describe, expect, it } from "vitest";

import { readNoShopping, withNoShopping } from "./shopping-state";

describe("no-shopping state", () => {
  it("writes the flag, reads it back and takes it out, keeping other keys", () => {
    const on = withNoShopping({ scrappyReview: "done", count: 3 }, true);
    expect(on).toEqual({ scrappyReview: "done", scrappyNoShopping: "true" });
    expect(readNoShopping(on)).toBe(true);
    const off = withNoShopping(on, false);
    expect(off).toEqual({ scrappyReview: "done" });
    expect(readNoShopping(off)).toBe(false);
  });

  it("is off for recipes without it, or anything but true", () => {
    expect(readNoShopping(null)).toBe(false);
    expect(readNoShopping({})).toBe(false);
    expect(readNoShopping({ scrappyNoShopping: "yes" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isFasting } from "./fasting";

describe("isFasting", () => {
  const wedAndFri = [3, 5];

  it("follows the default weekdays", () => {
    expect(isFasting(wedAndFri, "2026-10-21")).toBe(true); // Wednesday
    expect(isFasting(wedAndFri, "2026-10-22")).toBe(false); // Thursday
    expect(isFasting([], "2026-10-21")).toBe(false);
  });

  it("lets a day override win either way", () => {
    expect(isFasting(wedAndFri, "2026-10-21", false)).toBe(false);
    expect(isFasting(wedAndFri, "2026-10-22", true)).toBe(true);
    expect(isFasting(wedAndFri, "2026-10-21", null)).toBe(true);
  });
});

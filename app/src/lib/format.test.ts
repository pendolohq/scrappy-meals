import { describe, expect, it } from "vitest";

import { formatDay, formatPortion, formatRange } from "./format";

describe("format", () => {
  it("formats days and ranges", () => {
    expect(formatDay("2026-10-20")).toBe("Tue 20 Oct");
    expect(formatRange("2026-10-19", "2026-10-25")).toBe("19 Oct – 25 Oct");
  });

  it.each([
    [0, "0"],
    [0.25, "¼"],
    [0.5, "½"],
    [1, "1"],
    [1.5, "1½"],
    [2.75, "2¾"],
    [1.3, "1.3"],
  ])("portion %d -> %s", (n, s) => {
    expect(formatPortion(n)).toBe(s);
  });
});

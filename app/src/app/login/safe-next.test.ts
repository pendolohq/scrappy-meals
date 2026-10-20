import { describe, expect, it } from "vitest";

import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/week/2026-10-19/shopping?x=1")).toBe(
      "/week/2026-10-19/shopping?x=1"
    );
  });

  it("refuses anything that could lead to another site", () => {
    for (const next of [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\tevil",
      "week",
      null,
    ]) {
      expect(safeNext(next)).toBe("/");
    }
  });
});

import { describe, expect, it } from "vitest";

import { cx } from "./cx";

describe("cx", () => {
  it("joins the truthy class names", () => {
    expect(cx("a", false, "b", null, undefined, "", "c")).toBe("a b c");
  });
});

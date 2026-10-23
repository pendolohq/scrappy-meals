import { describe, expect, it } from "vitest";

import { UserFacingError } from "../errors";

import { createUsdaLimits } from "./limits";

describe("USDA limits", () => {
  it("lets a person search 120 times an hour, then refuses", () => {
    let t = 0;
    const limits = createUsdaLimits(() => t);
    for (let i = 0; i < 120; i++) {
      limits.search("alex");
    }
    expect(() => limits.search("alex")).toThrow(UserFacingError);
    limits.search("sam");
    t += 60 * 60 * 1000 + 1;
    limits.search("alex");
  });

  it("counts confirmations apart from searches", () => {
    const limits = createUsdaLimits(() => 0);
    for (let i = 0; i < 120; i++) {
      limits.search("alex");
    }
    limits.confirm("alex");
    for (let i = 1; i < 120; i++) {
      limits.confirm("alex");
    }
    expect(() => limits.confirm("alex")).toThrow(UserFacingError);
  });
});

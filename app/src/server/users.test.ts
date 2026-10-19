import { describe, expect, it } from "vitest";

import { profileSchema } from "./users";

const profile = {
  name: "Alex",
  targetKcal: 2000,
  targetProteinG: 150,
  targetCarbsG: null,
  targetFatG: null,
  targetFibreG: null,
  defaultFastingDays: [],
};

describe("profileSchema", () => {
  it("accepts a normal profile", () => {
    expect(profileSchema.safeParse(profile).success).toBe(true);
  });

  it("refuses targets too small to store (they'd read as no target)", () => {
    expect(
      profileSchema.safeParse({ ...profile, targetProteinG: 0.04 }).success
    ).toBe(false);
  });
});

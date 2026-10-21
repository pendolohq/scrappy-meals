import { describe, expect, it } from "vitest";

import { AISLES, aisleOf } from "./aisles";

describe("aisleOf", () => {
  it("maps Mealie's seeded labels onto the shop's aisles", () => {
    expect(aisleOf("Fresh Produce")).toBe("Fruit & veg");
    expect(aisleOf("Seafood")).toBe("Meat & fish");
    expect(aisleOf("Health Foods")).toBe("Dairy, eggs & tofu");
    expect(aisleOf("Oils")).toBe("Spices, oils & condiments");
    expect(aisleOf("Alcohol")).toBe("Drinks");
  });

  it("takes a label named like an aisle, in any case", () => {
    for (const aisle of AISLES) {
      expect(aisleOf(` ${aisle.toUpperCase()} `)).toBe(aisle);
    }
  });

  it("puts unlabelled foods and unknown labels under Other", () => {
    expect(aisleOf(null)).toBe("Other");
    expect(aisleOf(undefined)).toBe("Other");
    expect(aisleOf("Household")).toBe("Other");
    expect(aisleOf("something else")).toBe("Other");
  });
});

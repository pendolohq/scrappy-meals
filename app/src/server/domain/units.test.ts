import { describe, expect, it } from "vitest";

import { measure, roundCount, roundMeasured } from "./units";

const unit = (
  standardQuantity: number | null,
  standardUnit: string | null
) => ({
  id: "u",
  name: "u",
  abbreviation: "",
  standardQuantity,
  standardUnit,
});

describe("measure", () => {
  it("turns weights into grams and volumes into millilitres", () => {
    expect(measure(2, unit(1, "kilogram"))).toEqual({ per: "g", amount: 2000 });
    expect(measure(1, unit(1, "pound"))?.amount).toBeCloseTo(453.59);
    expect(measure(1, unit(1, "cup"))).toMatchObject({ per: "ml" });
    expect(measure(1, unit(1, "cup"))?.amount).toBeCloseTo(236.59);
  });

  it("goes through the unit's standard quantity", () => {
    // Mealie's tablespoon is half a fluid ounce.
    expect(measure(2, unit(0.5, "fluid_ounce"))?.amount).toBeCloseTo(29.57);
    expect(measure(3, unit(0.001, "gram"))?.amount).toBeCloseTo(0.003);
  });

  it("leaves units Mealie has no size for, and missing units, alone", () => {
    expect(measure(1, unit(null, null))).toBeNull();
    expect(measure(1, unit(1, "bunch"))).toBeNull();
    expect(measure(1, unit(0, "gram"))).toBeNull();
    // Rows cached before units carried a standard.
    expect(measure(1, { id: "u", name: "g", abbreviation: "g" })).toBeNull();
    expect(measure(1, null)).toBeNull();
  });
});

describe("roundMeasured", () => {
  it("rounds up to whole grams to 100, then to the next 10", () => {
    expect(roundMeasured(0.3)).toBe(1);
    expect(roundMeasured(29.57)).toBe(30);
    expect(roundMeasured(100)).toBe(100);
    expect(roundMeasured(101)).toBe(110);
    expect(roundMeasured(453.59)).toBe(460);
    expect(roundMeasured(1250)).toBe(1250);
  });

  it("doesn't round floating-point noise up", () => {
    expect(roundMeasured(150.000_000_01)).toBe(150);
    expect(roundMeasured(0.1 + 0.2)).toBe(1);
  });
});

describe("roundCount", () => {
  it("rounds up to a whole one", () => {
    expect(roundCount(1.5)).toBe(2);
    expect(roundCount(0.25)).toBe(1);
    expect(roundCount(2.1)).toBe(3);
    expect(roundCount(2)).toBe(2);
    expect(roundCount(0.5 + 0.5 + 0.5 + 0.5)).toBe(2);
  });
});

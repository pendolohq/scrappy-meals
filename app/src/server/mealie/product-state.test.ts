import { describe, expect, it } from "vitest";

import {
  PRODUCT_EXTRAS,
  readProductState,
  withProductState,
} from "./product-state";

const info = {
  barcode: "5000159461122",
  servingGrams: 60,
  servingUnit: "g",
  packGrams: 180,
} as const;

const extras = (over: Record<string, unknown> = {}) => ({
  scrappyProduct: "5000159461122",
  scrappyServingGrams: "60",
  scrappyServingUnit: "g",
  scrappyPackGrams: "180",
  ...over,
});

describe("PRODUCT_EXTRAS", () => {
  it("names the keys the recipe carries", () => {
    expect(PRODUCT_EXTRAS).toEqual({
      barcode: "scrappyProduct",
      servingGrams: "scrappyServingGrams",
      servingUnit: "scrappyServingUnit",
      packGrams: "scrappyPackGrams",
    });
  });
});

describe("readProductState", () => {
  it("reads the keys the planner writes", () => {
    expect(readProductState(extras())).toEqual(info);
    expect(readProductState(extras({ scrappyServingUnit: "ml" }))).toEqual({
      ...info,
      servingUnit: "ml",
    });
  });

  it("is null for a recipe that isn't a product", () => {
    expect(readProductState(undefined)).toBeNull();
    expect(readProductState(null)).toBeNull();
    expect(readProductState({})).toBeNull();
    expect(readProductState({ scrappyReview: "done" })).toBeNull();
  });

  it("is null without a valid barcode", () => {
    expect(
      readProductState(extras({ scrappyProduct: "5000159461123" }))
    ).toBeNull();
    expect(readProductState(extras({ scrappyProduct: "soup" }))).toBeNull();
    expect(
      readProductState(extras({ scrappyProduct: 5000159461122 }))
    ).toBeNull();
  });

  it("is null without a positive serving", () => {
    for (const bad of ["0", "-5", "abc", "", undefined]) {
      expect(readProductState(extras({ scrappyServingGrams: bad }))).toBeNull();
    }
  });

  it("falls back to grams for an unknown unit", () => {
    expect(
      readProductState(extras({ scrappyServingUnit: "oz" }))
    ).toMatchObject({
      servingUnit: "g",
    });
    expect(
      readProductState(extras({ scrappyServingUnit: undefined }))
    ).toMatchObject({
      servingUnit: "g",
    });
  });

  it("treats a missing or bad pack size as unknown", () => {
    for (const bad of ["0", "-1", "lots", "", undefined]) {
      expect(readProductState(extras({ scrappyPackGrams: bad }))).toEqual({
        ...info,
        packGrams: null,
      });
    }
  });
});

describe("withProductState", () => {
  it("writes our keys as strings and keeps other string extras", () => {
    expect(
      withProductState({ mine: "x", scrappyReview: "done", n: 3 }, info)
    ).toEqual({
      mine: "x",
      scrappyReview: "done",
      ...extras(),
    });
  });

  it("drops a stale pack size when there is none now", () => {
    expect(
      withProductState(
        { scrappyPackGrams: "180" },
        { ...info, packGrams: null }
      )
    ).not.toHaveProperty("scrappyPackGrams");
  });

  it("starts from nothing", () => {
    expect(withProductState(null, info)).toEqual(extras());
    expect(withProductState({}, info)).toEqual(extras());
  });

  it("round-trips through readProductState", () => {
    for (const state of [
      info,
      { ...info, packGrams: null },
      {
        barcode: "73513537",
        servingGrams: 1.5,
        servingUnit: "ml",
        packGrams: 33.3,
      },
    ] as const) {
      expect(readProductState(withProductState(null, state))).toEqual(state);
    }
  });
});

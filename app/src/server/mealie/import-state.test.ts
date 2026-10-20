import { describe, expect, it } from "vitest";

import { readImportState, withImportState } from "./import-state";

describe("readImportState", () => {
  it("treats a recipe without our keys as done, with no nutrition source", () => {
    expect(readImportState(undefined)).toEqual({
      review: "done",
      nutrition: null,
    });
    expect(readImportState({})).toEqual({ review: "done", nutrition: null });
  });

  it("reads the keys the planner writes", () => {
    expect(
      readImportState({
        scrappyReview: "pending",
        scrappyNutrition: "estimated",
      })
    ).toEqual({ review: "pending", nutrition: "estimated" });
  });

  it("ignores values it doesn't know", () => {
    expect(
      readImportState({ scrappyReview: "maybe", scrappyNutrition: 3 })
    ).toEqual({ review: "done", nutrition: null });
  });
});

describe("withImportState", () => {
  it("keeps other string extras and writes ours", () => {
    expect(
      withImportState(
        { mine: "x", scrappyNutrition: "source" },
        { review: "done", nutrition: "reviewed" }
      )
    ).toEqual({
      mine: "x",
      scrappyReview: "done",
      scrappyNutrition: "reviewed",
    });
  });

  it("drops the nutrition key when there is no source", () => {
    expect(
      withImportState(
        { scrappyNutrition: "source" },
        { review: "pending", nutrition: null }
      )
    ).toEqual({ scrappyReview: "pending" });
  });

  it("round-trips through readImportState", () => {
    const state = { review: "pending", nutrition: "estimated" } as const;
    expect(readImportState(withImportState(null, state))).toEqual(state);
  });
});

import { describe, expect, it } from "vitest";

import { reviewInputSchema } from "./review-input";

/*
 * Contract: `reviewInputSchema` (zod, pure, no server-only import) is the
 * input of saveReview and is what the review action parses. Exports
 * `reviewInputSchema` and `type ReviewInput = z.infer<typeof reviewInputSchema>`.
 * The action adds `slug` itself.
 */

const nutrition = {
  kcal: 320,
  protein: null,
  carbs: 40.5,
  fat: 0,
  fibre: null,
};

const line = {
  title: null,
  asText: false,
  quantity: 200,
  unit: "gram",
  food: "red lentils",
  note: "",
};

function valid(overrides: Record<string, unknown> = {}) {
  return { servings: 4, nutrition, lines: [line], ...overrides };
}

describe("reviewInputSchema", () => {
  it("accepts a full review", () => {
    expect(reviewInputSchema.safeParse(valid()).success).toBe(true);
  });

  it("accepts null amounts, units and foods, and no lines", () => {
    const result = reviewInputSchema.safeParse(
      valid({
        lines: [{ ...line, quantity: null, unit: null, food: null }],
      })
    );
    expect(result.success).toBe(true);
    expect(reviewInputSchema.safeParse(valid({ lines: [] })).success).toBe(
      true
    );
  });

  it("accepts fractional servings", () => {
    expect(reviewInputSchema.safeParse(valid({ servings: 2.5 })).success).toBe(
      true
    );
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "4"],
    ["null", null],
  ])("rejects servings that are %s", (_l, servings) => {
    expect(reviewInputSchema.safeParse(valid({ servings })).success).toBe(
      false
    );
  });

  it("rejects a missing servings field", () => {
    const { servings: _servings, ...rest } = valid();
    expect(reviewInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a negative macro", () => {
    expect(
      reviewInputSchema.safeParse(
        valid({ nutrition: { ...nutrition, protein: -1 } })
      ).success
    ).toBe(false);
  });

  it("rejects a non-finite macro", () => {
    expect(
      reviewInputSchema.safeParse(
        valid({ nutrition: { ...nutrition, kcal: Number.NaN } })
      ).success
    ).toBe(false);
  });

  it("rejects nutrition missing a macro", () => {
    const { fibre: _fibre, ...rest } = nutrition;
    expect(
      reviewInputSchema.safeParse(valid({ nutrition: rest })).success
    ).toBe(false);
  });

  it("accepts 200 lines and rejects 201", () => {
    const lines = (n: number) => Array.from({ length: n }, () => line);
    expect(
      reviewInputSchema.safeParse(valid({ lines: lines(200) })).success
    ).toBe(true);
    expect(
      reviewInputSchema.safeParse(valid({ lines: lines(201) })).success
    ).toBe(false);
  });

  it("rejects a negative line amount", () => {
    expect(
      reviewInputSchema.safeParse(valid({ lines: [{ ...line, quantity: -2 }] }))
        .success
    ).toBe(false);
  });

  it("rejects a line without asText or note", () => {
    const { asText: _a, ...noAsText } = line;
    const { note: _n, ...noNote } = line;
    expect(
      reviewInputSchema.safeParse(valid({ lines: [noAsText] })).success
    ).toBe(false);
    expect(
      reviewInputSchema.safeParse(valid({ lines: [noNote] })).success
    ).toBe(false);
  });
});

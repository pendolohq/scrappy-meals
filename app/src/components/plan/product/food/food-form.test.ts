import { describe, expect, it } from "vitest";

import type { UsdaFood } from "@/server/domain/usda";
import type { FoodCandidate } from "@/server/foods";

import {
  emptyValues,
  estimateLine,
  type FoodForm,
  isPicked,
  matchWarning,
  nutritionToSave,
  readForm,
  startingPiece,
} from "./food-form";

const usdaKiwi: UsdaFood = {
  fdcId: 168153,
  description: "Kiwifruit, green, raw",
  dataType: "SR Legacy",
  per100g: { kcal: 61, protein: 1.14, carbs: 14.66, fat: 0.52, fibre: 3 },
  portions: [
    { label: "1 cup, sliced", measure: "cup", grams: 180 },
    { label: '1 fruit (2" dia)', measure: "fruit", grams: 69 },
  ],
};

const kiwi = (
  match: Partial<NonNullable<FoodCandidate["match"]>> | null = {}
): FoodCandidate => ({
  id: "food-kiwi",
  name: "Kiwi",
  gramsPerMl: null,
  match: match && {
    fdcId: usdaKiwi.fdcId,
    status: "confirmed",
    pieceGrams: 69,
    pieceLabel: '1 fruit (2" dia)',
    unitGrams: {},
    defaultGrams: null,
    foodName: "Kiwi",
    food: usdaKiwi,
    ...match,
  },
});

const form = (over: Partial<FoodForm> = {}): FoodForm => ({
  picked: { food: kiwi() },
  source: { kind: "usda", food: usdaKiwi },
  amount: "2",
  unit: "piece",
  pieceText: "69",
  values: emptyValues(),
  ...over,
});

// Values typed in, with the rest of the form as `form` has it.
const own = (values: Partial<Record<string, string>>) =>
  readForm(
    form({
      source: { kind: "own" },
      values: { ...emptyValues(), ...values },
    })
  );

describe("readForm", () => {
  it("counts pieces of a USDA food and is ready to save", () => {
    const reading = readForm(form());
    expect(reading.serving).toEqual({ amount: 2, unit: "piece" });
    expect(reading.counted).toMatchObject({
      grams: 138,
      perServing: { kcal: 84 },
    });
    expect(reading.ready).toBe(true);
  });

  it("isn't ready without a weight for one piece, or an amount above 0", () => {
    expect(readForm(form({ pieceText: "" }))).toMatchObject({
      pieceOk: false,
      ready: false,
    });
    expect(readForm(form({ amount: "0" }))).toMatchObject({
      serving: null,
      counted: null,
      ready: false,
    });
  });

  it("needs no piece weight for grams", () => {
    const reading = readForm(form({ amount: "150", unit: "g", pieceText: "" }));
    expect(reading.pieceOk).toBe(true);
    expect(reading.counted).toMatchObject({ grams: 150 });
    expect(reading.ready).toBe(true);
  });

  it("asks for grams when USDA has no weight for a volume", () => {
    const noCup = { ...usdaKiwi, portions: usdaKiwi.portions.slice(1) };
    const reading = readForm(
      form({ amount: "200", unit: "ml", source: { kind: "usda", food: noCup } })
    );
    expect(reading.counted).toEqual({ problem: "no volume weight" });
    expect(reading.ready).toBe(false);
  });

  it("saves values typed in only with the calories, and none that aren't numbers", () => {
    expect(own({ protein: "5" }).ready).toBe(false);
    expect(own({ kcal: "50", protein: "-1" })).toMatchObject({
      own: { invalid: true },
      ready: false,
    });
    expect(own({ kcal: "50", protein: "1,5" })).toMatchObject({
      own: { values: { kcal: 50, protein: 1.5 }, invalid: false },
      ready: true,
    });
  });

  it("isn't ready before a food or a source is picked", () => {
    expect(readForm(form({ picked: undefined })).ready).toBe(false);
    expect(readForm(form({ source: undefined })).ready).toBe(false);
  });
});

describe("nutritionToSave", () => {
  it("sends only the USDA food, or the values with their calories", () => {
    expect(
      nutritionToSave({ kind: "usda", food: usdaKiwi }, { kcal: 1 }, false)
    ).toEqual({ from: "usda", fdcId: usdaKiwi.fdcId });
    expect(nutritionToSave({ kind: "own" }, { kcal: 50 }, true)).toEqual({
      from: "own",
      perServing: { kcal: 50 },
      estimated: true,
    });
    expect(nutritionToSave({ kind: "own" }, { protein: 5 }, false)).toBeNull();
  });
});

describe("matchWarning", () => {
  const usda = { kind: "usda", food: usdaKiwi } as const;

  it("warns that another USDA food changes the match for every recipe", () => {
    const other = { ...usdaKiwi, fdcId: 1 };
    expect(
      matchWarning({ food: kiwi() }, { kind: "usda", food: other }, "piece", 69)
    ).toBe(
      "Saving changes the USDA match of Kiwi for every recipe that uses it."
    );
  });

  it("warns that another weight of one piece changes it for every recipe", () => {
    expect(matchWarning({ food: kiwi() }, usda, "piece", 80)).toBe(
      "Saving changes what one Kiwi weighs for every recipe that uses it."
    );
  });

  it("says nothing when nothing the food has changes", () => {
    expect(matchWarning({ food: kiwi() }, usda, "piece", 69)).toBeNull();
    expect(matchWarning({ food: kiwi() }, usda, "g", 80)).toBeNull();
    expect(
      matchWarning({ food: kiwi({ pieceGrams: null }) }, usda, "piece", 80)
    ).toBeNull();
    expect(matchWarning({ food: kiwi(null) }, usda, "piece", 80)).toBeNull();
    expect(
      matchWarning({ food: kiwi({ status: "suggested" }) }, usda, "piece", 80)
    ).toBeNull();
    expect(matchWarning({ create: "Kiwi" }, usda, "piece", 80)).toBeNull();
    expect(
      matchWarning({ food: kiwi() }, { kind: "own" }, "piece", 80)
    ).toBeNull();
  });
});

describe("startingPiece", () => {
  it("starts from the food's own weight, else USDA's usual piece", () => {
    expect(startingPiece(usdaKiwi, 75, null)).toEqual({
      text: "75",
      label: null,
    });
    expect(startingPiece(usdaKiwi, null, null)).toEqual({
      text: "69",
      label: '1 fruit (2" dia)',
    });
    expect(startingPiece({ ...usdaKiwi, portions: [] }, null, null)).toEqual({
      text: "",
      label: null,
    });
  });
});

describe("estimateLine", () => {
  it("gives Claude the pieces with their weight", () => {
    const food = { id: "food-kiwi", name: "Kiwi", gramsPerMl: null };
    expect(estimateLine({ amount: 2, unit: "piece" }, 69, food)).toBe(
      "2 pieces (138 g) Kiwi"
    );
    expect(estimateLine({ amount: 150, unit: "g" }, 69, food)).toBe(
      "150 g Kiwi"
    );
  });
});

describe("isPicked", () => {
  it("tells a Mealie food from a new one", () => {
    expect(isPicked({ food: kiwi() }, { food: kiwi() })).toBe(true);
    expect(isPicked({ create: "Kiwi" }, { food: kiwi() })).toBe(false);
    expect(isPicked({ create: "Kiwi" }, { create: "Kiwi" })).toBe(true);
    expect(isPicked(undefined, { create: "Kiwi" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  type OffFixture,
  offFixtureCode,
  offFixtureText,
} from "../../../test/off-fixtures";
import type { MacroKey, Macros } from "../mealie/nutrition";
import { lookupOpenFoodFacts } from "../openfoodfacts";

import {
  draftFromOff,
  macrosInconsistent,
  offImageUrl,
  type OffProduct,
  type ProductInfo,
  perServing,
  productName,
  servingsFor,
} from "./product";

/** A fixture through the real OFF parser, then into a draft. */
async function draftOf(name: OffFixture) {
  const code = offFixtureCode(name);
  const result = await lookupOpenFoodFacts(code, {
    fetch: async () => new Response(offFixtureText(name), { status: 200 }),
  });
  if (result.status !== "found") {
    throw new Error(`${name} should be found`);
  }
  return {
    code,
    product: result.product,
    draft: draftFromOff(code, result.product),
  };
}

const BARCODE = "5000159461122";

const off = (over: Partial<OffProduct> = {}): OffProduct => ({
  name: "Bar",
  brand: null,
  quantity: null,
  productQuantity: null,
  productQuantityUnit: null,
  servingQuantity: null,
  servingQuantityUnit: null,
  per100: {},
  kcalFromKj: false,
  imageUrl: null,
  ...over,
});

const serving = (over: Partial<OffProduct>) => {
  const { servingGrams, servingUnit, packGrams } = draftFromOff(
    BARCODE,
    off(over)
  );
  return { servingGrams, servingUnit, packGrams };
};

describe("offImageUrl", () => {
  it.each([
    "https://images.openfoodfacts.org/images/products/500/front_en.3.400.jpg",
    "https://static.openfoodfacts.org/images/logo.png",
  ])("accepts %s", (url) => {
    expect(offImageUrl(url)).toBe(url);
  });

  it.each([
    "http://images.openfoodfacts.org/a.jpg",
    "https://openfoodfacts.org/a.jpg",
    "https://images.openfoodfacts.org.evil.example/a.jpg",
    "https://evil.example/https://images.openfoodfacts.org/a.jpg",
    "https://images.openfoodfacts.org@evil.example/a.jpg",
    "https://user:pw@images.openfoodfacts.org/a.jpg",
    "https://images.openfoodfacts.org:8443/a.jpg",
    "http://169.254.169.254/latest",
    "javascript:alert(1)",
    "/images/a.jpg",
    "",
    "   ",
  ])("refuses %j", (url) => {
    expect(offImageUrl(url)).toBeNull();
  });

  it("refuses what isn't a string", () => {
    expect(offImageUrl(undefined)).toBeNull();
    expect(offImageUrl(null)).toBeNull();
    expect(offImageUrl(12)).toBeNull();
  });
});

describe("productName", () => {
  it("puts the first brand in front of the name", () => {
    expect(productName("Carb Killa", "Grenade")).toBe("Grenade Carb Killa");
    expect(productName("Carb Killa", "Grenade, Grenade UK")).toBe(
      "Grenade Carb Killa"
    );
  });

  it("adds no brand when the name already contains one of them", () => {
    expect(productName("Snickers", "Mars Wrigley UK, Snickers")).toBe(
      "Snickers"
    );
    expect(productName("Original Coca-Cola", "Coca-Cola")).toBe(
      "Original Coca-Cola"
    );
  });

  it("compares brands ignoring case", () => {
    expect(productName("Walkers ready salted", "Walkers")).toBe(
      "Walkers ready salted"
    );
    expect(productName("walkers ready salted", "WALKERS")).toBe(
      "walkers ready salted"
    );
  });

  it("uses the name alone without a brand", () => {
    expect(productName("Grenade carb killa", null)).toBe("Grenade carb killa");
  });

  it("collapses whitespace and caps the length at 120", () => {
    expect(productName("  Carb \n  Killa ", " Grenade ")).toBe(
      "Grenade Carb Killa"
    );
    expect(productName("x".repeat(300), "Brand")).toHaveLength(120);
  });

  it("is empty when there is no name, so the user has to type one", () => {
    expect(productName(null, null)).toBe("");
    expect(productName("   ", null)).toBe("");
  });
});

describe("draftFromOff (recorded responses)", () => {
  it("Snickers: serving and pack are both 50 g", async () => {
    const { draft } = await draftOf("snickers");
    expect(draft).toMatchObject({
      barcode: "5000159461122",
      name: "Snickers",
      servingGrams: 50,
      servingUnit: "g",
      packGrams: 50,
      missing: [],
      kcalFromKj: false,
      inconsistent: false,
      sourceUrl: "https://world.openfoodfacts.org/product/5000159461122",
    });
    expect(draft.per100).toEqual({
      kcal: 481,
      protein: 8.6,
      carbs: 60.5,
      fat: 22.5,
      fibre: 4.3,
    });
  });

  it("Grenade: no serving, so one unit of '3 x 60 g'; fibre is missing, not guessed", async () => {
    const { draft } = await draftOf("grenade-multipack");
    expect(draft).toMatchObject({
      name: "Grenade carb killa",
      servingGrams: 60,
      servingUnit: "g",
      packGrams: 180,
      missing: ["fibre"],
      inconsistent: false,
    });
    expect(draft.per100.fibre).toBeUndefined();
  });

  it("Fage: the serving is 100 g, not the 450 g pot", async () => {
    const { draft } = await draftOf("fage-pot");
    expect(draft).toMatchObject({
      name: "FAGE Total 0% fat",
      servingGrams: 100,
      packGrams: 450,
      missing: [],
      inconsistent: false,
    });
  });

  it("Coca-Cola: millilitres", async () => {
    const { draft } = await draftOf("coca-cola-can");
    expect(draft).toMatchObject({
      servingGrams: 330,
      servingUnit: "ml",
      packGrams: 330,
      missing: ["fibre"],
      inconsistent: false,
    });
  });

  it("Walkers: no serving and no pack falls back to 100 g", async () => {
    const { draft } = await draftOf("walkers-no-serving");
    expect(draft).toMatchObject({
      name: "Walkers ready salted",
      servingGrams: 100,
      servingUnit: "g",
      packGrams: null,
      missing: ["fibre"],
    });
  });

  it("Kind: takes OFF's 20 g serving, trusts its kcal, and flags numbers that don't add up", async () => {
    const { draft } = await draftOf("kind-kj-mismatch");
    expect(draft).toMatchObject({
      name: "KIND minis Caramel Almond & Sea Salt",
      servingGrams: 20,
      packGrams: null,
      kcalFromKj: false,
      missing: [],
    });
    expect(draft.per100.kcal).toBe(450);
    // 4*15 + 4*40 + 9*40 + 2*20 = 620 against 450 kcal
    expect(draft.inconsistent).toBe(true);
  });

  it("Huel: nutrition only for the prepared product means every macro is missing", async () => {
    const { draft } = await draftOf("huel-prepared-only");
    expect(draft).toMatchObject({
      name: "Huel Complete Nutrition Bar - Chocolate Fudge Brownie",
      servingGrams: 51,
      packGrams: null,
      missing: ["kcal", "protein", "carbs", "fat", "fibre"],
      inconsistent: false,
    });
    expect(draft.per100).toEqual({});
  });
});

describe("draftFromOff (serving rules)", () => {
  it("takes OFF's serving when the unit is absent", () => {
    expect(serving({ servingQuantity: 30 })).toMatchObject({
      servingGrams: 30,
      servingUnit: "g",
    });
  });

  it("ignores a serving bigger than the pack", () => {
    expect(
      serving({
        servingQuantity: 300,
        servingQuantityUnit: "g",
        productQuantity: 180,
        productQuantityUnit: "g",
      })
    ).toMatchObject({ servingGrams: 180, packGrams: 180 });
  });

  it("ignores a zero serving and falls through to the multipack", () => {
    expect(
      serving({
        servingQuantity: 0,
        quantity: "3 x 60 g",
        productQuantity: 180,
      })
    ).toMatchObject({ servingGrams: 60 });
  });

  it("reads multipack quantities in several spellings", () => {
    expect(serving({ quantity: "4×125 G" }).servingGrams).toBe(125);
    expect(serving({ quantity: " 6 X 1,5 ml " })).toMatchObject({
      servingGrams: 1.5,
      servingUnit: "ml",
    });
  });

  it("uses the whole pack up to 250, and 100 beyond", () => {
    expect(
      serving({ productQuantity: 250, productQuantityUnit: "g" })
    ).toMatchObject({ servingGrams: 250, packGrams: 250 });
    expect(
      serving({ productQuantity: 400, productQuantityUnit: "g" })
    ).toMatchObject({ servingGrams: 100, packGrams: 400 });
  });

  it("is in ml when the pack is in ml", () => {
    expect(
      serving({ productQuantity: 200, productQuantityUnit: "ml" })
    ).toMatchObject({ servingGrams: 200, servingUnit: "ml", packGrams: 200 });
  });

  it("has no pack size for a unit it can't read", () => {
    expect(
      serving({ productQuantity: 2, productQuantityUnit: "kg" }).packGrams
    ).toBeNull();
    expect(serving({ productQuantity: 0 }).packGrams).toBeNull();
  });

  it("falls back to 100 g with nothing to go on", () => {
    expect(serving({})).toEqual({
      servingGrams: 100,
      servingUnit: "g",
      packGrams: null,
    });
  });

  it("leaves the name empty when OFF has none", () => {
    expect(draftFromOff(BARCODE, off({ name: null, brand: null })).name).toBe(
      ""
    );
  });

  it("carries kcalFromKj through", () => {
    expect(
      draftFromOff(BARCODE, off({ per100: { kcal: 482 }, kcalFromKj: true }))
        .kcalFromKj
    ).toBe(true);
  });

  it("lists missing macros in MACRO_KEYS order and never fills them in", () => {
    const draft = draftFromOff(
      BARCODE,
      off({ per100: { fat: 3, protein: 0 } })
    );
    expect(draft.missing).toEqual([
      "kcal",
      "carbs",
      "fibre",
    ] satisfies MacroKey[]);
    expect(draft.per100).toEqual({ fat: 3, protein: 0 });
  });
});

const macros = (over: Partial<Macros>): Partial<Macros> => ({
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 10,
  ...over,
});

describe("macrosInconsistent", () => {
  it("flags kcal far from 4p + 4c + 9f", () => {
    // expected 170 against 100
    expect(macrosInconsistent(macros({}))).toBe(true);
    // expected 90 against 250
    expect(
      macrosInconsistent({ kcal: 250, protein: 10, carbs: 10, fat: 1 })
    ).toBe(true);
  });

  it("accepts numbers that agree within 20 %", () => {
    expect(
      macrosInconsistent({ kcal: 165, protein: 10, carbs: 10, fat: 10 })
    ).toBe(false);
  });

  it("counts fibre at 2 kcal/g", () => {
    // 170 + 2*10 = 190 against 165: fine only with fibre counted
    expect(
      macrosInconsistent({ kcal: 150, protein: 10, carbs: 10, fat: 10 })
    ).toBe(false);
    expect(
      macrosInconsistent({
        kcal: 150,
        protein: 10,
        carbs: 10,
        fat: 10,
        fibre: 25,
      })
    ).toBe(true);
  });

  it("doesn't judge when any of kcal, protein, carbs or fat is missing", () => {
    expect(macrosInconsistent({ protein: 10, carbs: 10, fat: 10 })).toBe(false);
    expect(macrosInconsistent({ kcal: 500, carbs: 10, fat: 10 })).toBe(false);
    expect(macrosInconsistent({})).toBe(false);
  });

  it("leaves tiny values alone (a zero drink)", () => {
    expect(
      macrosInconsistent({ kcal: 1, protein: 0, carbs: 0.1, fat: 0 })
    ).toBe(false);
    expect(macrosInconsistent({ kcal: 0, protein: 0, carbs: 4, fat: 0 })).toBe(
      false
    );
  });
});

describe("perServing", () => {
  it("scales per-100 values by the serving and rounds to one decimal", () => {
    // 364 / 33.8 / 28.2 / 14.8 at 60 g
    expect(
      perServing({ kcal: 364, protein: 33.8, carbs: 28.2, fat: 14.8 }, 60)
    ).toEqual({ kcal: 218.4, protein: 20.3, carbs: 16.9, fat: 8.9 });
  });

  it("matches the label's own per-serving figures for Kind (20 g)", async () => {
    const { draft } = await draftOf("kind-kj-mismatch");
    expect(perServing(draft.per100, draft.servingGrams)).toEqual({
      kcal: 90,
      protein: 3,
      carbs: 8,
      fat: 8,
      fibre: 4,
    });
  });

  it("keeps zeros and leaves absent macros absent", async () => {
    const { draft } = await draftOf("coca-cola-can");
    const result = perServing(draft.per100, 330);
    expect(result).toEqual({ kcal: 139.9, protein: 0, carbs: 35, fat: 0 });
    expect("fibre" in result).toBe(false);
    expect(perServing({}, 50)).toEqual({});
  });
});

describe("servingsFor", () => {
  const info: ProductInfo = {
    barcode: BARCODE,
    servingGrams: 60,
    servingUnit: "g",
    packGrams: 180,
  };
  /** The servings, or null when the choice is refused (throw or null). */
  const servings = (
    choice: Parameters<typeof servingsFor>[0],
    from: ProductInfo = info
  ) => {
    try {
      return servingsFor(choice, from);
    } catch {
      return null;
    }
  };

  it("counts servings as they are", () => {
    expect(servings({ kind: "servings", count: 1 })).toBe(1);
    expect(servings({ kind: "servings", count: 0.5 })).toBe(0.5);
    expect(servings({ kind: "servings", count: 2 })).toBe(2);
  });

  it("turns the whole pack into servings", () => {
    expect(servings({ kind: "pack" })).toBe(3);
  });

  it("turns grams into servings, rounded to 2 decimals", () => {
    expect(servings({ kind: "grams", grams: 90 })).toBe(1.5);
    expect(servings({ kind: "grams", grams: 100 })).toBe(1.67);
    expect(servings({ kind: "grams", grams: 6000 })).toBe(100);
  });

  it("refuses 'whole pack' when the pack size is unknown", () => {
    expect(servings({ kind: "pack" }, { ...info, packGrams: null })).toBeNull();
  });

  it("refuses results outside 0.01 to 100", () => {
    expect(servings({ kind: "servings", count: 0 })).toBeNull();
    expect(servings({ kind: "servings", count: -1 })).toBeNull();
    expect(servings({ kind: "servings", count: 100.5 })).toBeNull();
    expect(servings({ kind: "grams", grams: 0.1 })).toBeNull();
    expect(servings({ kind: "grams", grams: 7000 })).toBeNull();
    expect(servings({ kind: "servings", count: 0.01 })).toBe(0.01);
    expect(servings({ kind: "servings", count: 100 })).toBe(100);
  });
});

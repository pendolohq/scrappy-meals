import { describe, expect, it, vi } from "vitest";

import { offFixtureCode, offFixtureText } from "../../test/off-fixtures";

import { draftFromOff, type ProductInfo } from "./domain/product";
import { RetryableError } from "./errors";
import { MealieUnavailableError } from "./mealie/client";
import type { Recipe } from "./mealie/recipes";
import { lookupOpenFoodFacts } from "./openfoodfacts";
import {
  loadKnownProduct,
  lookupProduct,
  ProductError,
  saveProduct,
} from "./products";

/*
 * Assumed dependency contracts (injected, like recipe-import.ts):
 *   find(barcode)     -> { slug, name } | null
 *   getRecipe(slug)   -> Recipe | null     (a product recipe has `product`)
 *   create(input)     -> slug              (createProductRecipe's input:
 *                        { name, info: ProductInfo, perServing, orgURL: string | null,
 *                          nutrition: "source" | "reviewed" })
 *   lookupOff(code)   -> the result of lookupOpenFoodFacts
 *   limiter           -> { hit(key): boolean }
 */
type LookupDeps = NonNullable<Parameters<typeof lookupProduct>[1]>;
type SaveDeps = NonNullable<Parameters<typeof saveProduct>[1]>;

const info: ProductInfo = {
  barcode: "5000159461122",
  servingGrams: 50,
  servingUnit: "g",
  packGrams: 50,
};

const productRecipe = (): Recipe => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug: "snickers",
  name: "Snickers",
  imagePath: null,
  servings: 1,
  totalMinutes: null,
  sourceUrl: null,
  importState: { review: "done", nutrition: "source" },
  ingredients: [],
  instructions: [],
  notes: [],
  tags: [{ name: "Product", slug: "product" }],
  categories: [],
  nutrition: {
    perServing: { kcal: 240.5, protein: 4.3 },
    missing: ["carbs", "fat", "fibre"],
    status: "partial",
  },
  product: info,
});

const offFound = (fixture: "snickers" | "grenade-multipack") =>
  lookupOpenFoodFacts(offFixtureCode(fixture), {
    fetch: async () => new Response(offFixtureText(fixture)),
  });

function lookupDeps(over: Partial<LookupDeps> = {}) {
  const find = vi.fn<NonNullable<LookupDeps["find"]>>().mockResolvedValue(null);
  const getRecipe = vi
    .fn<NonNullable<LookupDeps["getRecipe"]>>()
    .mockResolvedValue(productRecipe());
  const lookupOff = vi
    .fn<NonNullable<LookupDeps["lookupOff"]>>()
    .mockResolvedValue({ status: "not-found" });
  const hit = vi.fn<(key: string) => boolean>().mockReturnValue(true);
  const deps: LookupDeps = {
    find,
    getRecipe,
    lookupOff,
    limiter: { hit },
    canContribute: () => false,
    ...over,
  };
  return { deps, find, getRecipe, lookupOff, hit };
}

describe("lookupProduct", () => {
  it("rejects something that isn't a barcode before touching anything", async () => {
    const { deps, find, lookupOff, hit } = lookupDeps();
    for (const bad of ["soup", "5000159461123", "123", ""]) {
      await expect(lookupProduct(bad, deps)).rejects.toBeInstanceOf(
        ProductError
      );
    }
    expect(find).not.toHaveBeenCalled();
    expect(lookupOff).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it("returns a product already in Mealie without asking Open Food Facts or the limiter", async () => {
    const { deps, find, getRecipe, lookupOff, hit } = lookupDeps();
    find.mockResolvedValue({ slug: "snickers", name: "Snickers" });

    await expect(lookupProduct("5000159461122", deps)).resolves.toEqual({
      status: "known",
      slug: "snickers",
      name: "Snickers",
      info,
      nutrition: productRecipe().nutrition,
    });
    expect(getRecipe).toHaveBeenCalledWith("snickers");
    expect(lookupOff).not.toHaveBeenCalled();
    expect(hit).not.toHaveBeenCalled();
  });

  it("looks a UPC-A up under its 13-digit key", async () => {
    const { deps, find } = lookupDeps();
    await lookupProduct("036000291452", deps);
    expect(find).toHaveBeenCalledWith("0036000291452");
  });

  it("builds a draft from Open Food Facts for an unknown barcode", async () => {
    const found = await offFound("snickers");
    if (found.status !== "found") {
      throw new Error("fixture should be found");
    }
    const { deps, lookupOff } = lookupDeps();
    lookupOff.mockResolvedValue(found);

    await expect(lookupProduct("5000159461122", deps)).resolves.toEqual({
      status: "draft",
      draft: draftFromOff("5000159461122", found.product),
      canContribute: false,
    });
    expect(lookupOff).toHaveBeenCalledWith("5000159461122");
  });

  it("says not-found, with the canonical barcode, when Open Food Facts doesn't know it", async () => {
    const { deps } = lookupDeps();
    await expect(lookupProduct("036000291452", deps)).resolves.toEqual({
      status: "not-found",
      barcode: "0036000291452",
      canContribute: false,
    });
  });

  it("offers to contribute a product Open Food Facts lacks, only when configured", async () => {
    const { deps } = lookupDeps({ canContribute: () => true });
    await expect(lookupProduct("5000159461122", deps)).resolves.toMatchObject({
      status: "not-found",
      canContribute: true,
    });

    const off = async (fixture: "grenade-multipack" | "snickers") => {
      const found = await lookupOpenFoodFacts(offFixtureCode(fixture), {
        fetch: async () => new Response(offFixtureText(fixture)),
      });
      const { deps: d, lookupOff } = lookupDeps({ canContribute: () => true });
      lookupOff.mockResolvedValue(found);
      return lookupProduct(offFixtureCode(fixture), d);
    };
    // Grenade has no serving size; Snickers has everything.
    await expect(off("grenade-multipack")).resolves.toMatchObject({
      status: "draft",
      canContribute: true,
    });
    await expect(off("snickers")).resolves.toMatchObject({
      status: "draft",
      canContribute: false,
    });

    const { deps: unconfigured } = lookupDeps();
    await expect(
      lookupProduct("5000159461122", unconfigured)
    ).resolves.toMatchObject({ canContribute: false });
  });

  it("limits lookups household-wide: one shared key, and no call to Open Food Facts when over", async () => {
    const { deps, lookupOff, hit } = lookupDeps();
    await lookupProduct("5000159461122", deps);
    await lookupProduct("73513537", deps);
    expect(hit.mock.calls[0][0]).toBe(hit.mock.calls[1][0]);

    hit.mockReturnValue(false);
    lookupOff.mockClear();
    const err = await lookupProduct("4006381333931", deps).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ProductError);
    expect(lookupOff).not.toHaveBeenCalled();
  });

  it("allows 10 lookups a minute with the real limiter, and refuses the 11th", async () => {
    const { deps } = lookupDeps();
    // Without an injected limiter the default one applies.
    const real: LookupDeps = { ...deps, limiter: undefined };
    const results = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(
        await lookupProduct("5000159461122", real).catch((e: unknown) => e)
      );
    }
    expect(results.slice(0, 10).every((r) => !(r instanceof Error))).toBe(true);
    expect(results[10]).toBeInstanceOf(ProductError);
  });

  it("passes a retryable Open Food Facts failure through", async () => {
    const { deps, lookupOff } = lookupDeps();
    lookupOff.mockRejectedValue(
      new RetryableError(
        "Open Food Facts isn't answering. Try again in a minute."
      )
    );
    await expect(lookupProduct("5000159461122", deps)).rejects.toBeInstanceOf(
      RetryableError
    );
  });

  it("says Mealie is unreachable, retryably", async () => {
    const { deps, find } = lookupDeps();
    find.mockRejectedValue(new MealieUnavailableError("down"));
    const err = await lookupProduct("5000159461122", deps).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(RetryableError);
    expect((err as Error).message).toBe(
      "Mealie isn't reachable right now. Try again in a moment."
    );
  });
});

describe("loadKnownProduct", () => {
  it("returns the same shape as a known lookup", async () => {
    const { deps, getRecipe } = lookupDeps();
    await expect(loadKnownProduct("snickers", deps)).resolves.toEqual({
      status: "known",
      slug: "snickers",
      name: "Snickers",
      info,
      nutrition: productRecipe().nutrition,
    });
    expect(getRecipe).toHaveBeenCalledWith("snickers");
  });

  it("refuses a recipe that isn't a product, or one that's gone", async () => {
    const { deps, getRecipe } = lookupDeps();
    getRecipe.mockResolvedValue({ ...productRecipe(), product: null });
    await expect(loadKnownProduct("soup", deps)).rejects.toBeInstanceOf(
      ProductError
    );
    getRecipe.mockResolvedValue(null);
    await expect(loadKnownProduct("gone", deps)).rejects.toBeInstanceOf(
      ProductError
    );
  });

  it("says Mealie is unreachable, retryably", async () => {
    const { deps, getRecipe } = lookupDeps();
    getRecipe.mockRejectedValue(new MealieUnavailableError("down"));
    await expect(loadKnownProduct("snickers", deps)).rejects.toBeInstanceOf(
      RetryableError
    );
  });
});

const grenadeInput = {
  barcode: "5060221206006",
  name: "Grenade Carb Killa",
  servingGrams: 60,
  servingUnit: "g" as const,
  packGrams: 180,
  per100: { kcal: 364, protein: 33.8, carbs: 28.2, fat: 14.8 },
  fromOpenFoodFacts: true,
  edited: false,
};

function saveDeps() {
  const find = vi.fn<NonNullable<SaveDeps["find"]>>().mockResolvedValue(null);
  const create = vi
    .fn<NonNullable<SaveDeps["create"]>>()
    .mockResolvedValue("grenade-carb-killa");
  const deps: SaveDeps = { find, create };
  return { deps, find, create };
}

describe("saveProduct", () => {
  it("creates the recipe with per-serving nutrition, the OFF link and source nutrition", async () => {
    const { deps, create } = saveDeps();

    await expect(saveProduct(grenadeInput, deps)).resolves.toEqual({
      slug: "grenade-carb-killa",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      name: "Grenade Carb Killa",
      info: {
        barcode: "5060221206006",
        servingGrams: 60,
        servingUnit: "g",
        packGrams: 180,
      },
      perServing: { kcal: 218.4, protein: 20.3, carbs: 16.9, fat: 8.9 },
      orgURL: "https://world.openfoodfacts.org/product/5060221206006",
      nutrition: "source",
    });
    expect(create.mock.calls[0][0].perServing).not.toHaveProperty("fibre");
  });

  it("marks the nutrition reviewed when the user changed a value", async () => {
    const { deps, create } = saveDeps();
    await saveProduct({ ...grenadeInput, edited: true }, deps);
    expect(create.mock.calls[0][0]).toMatchObject({
      nutrition: "reviewed",
      orgURL: "https://world.openfoodfacts.org/product/5060221206006",
    });
  });

  it("marks a product typed in by hand reviewed, with no source link", async () => {
    const { deps, create } = saveDeps();
    await saveProduct(
      { ...grenadeInput, fromOpenFoodFacts: false, edited: false },
      deps
    );
    const arg = create.mock.calls[0][0];
    expect(arg.nutrition).toBe("reviewed");
    expect(arg.orgURL ?? null).toBeNull();
  });

  it("normalises the barcode it saves under", async () => {
    const { deps, find, create } = saveDeps();
    await saveProduct({ ...grenadeInput, barcode: "036000291452" }, deps);
    expect(find).toHaveBeenCalledWith("0036000291452");
    expect(create.mock.calls[0][0].info.barcode).toBe("0036000291452");
  });

  it("returns the existing product instead of creating a duplicate", async () => {
    const { deps, find, create } = saveDeps();
    find.mockResolvedValue({ slug: "old-grenade", name: "Grenade" });
    await expect(saveProduct(grenadeInput, deps)).resolves.toEqual({
      slug: "old-grenade",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an invalid barcode", async () => {
    const { deps, create } = saveDeps();
    await expect(
      saveProduct({ ...grenadeInput, barcode: "5060221206007" }, deps)
    ).rejects.toBeInstanceOf(ProductError);
    expect(create).not.toHaveBeenCalled();
  });
});

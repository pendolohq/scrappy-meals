import { describe, expect, it, vi } from "vitest";

import { RetryableError, UserFacingError } from "./errors";
import { MealieError, MealieUnavailableError } from "./mealie/client";
import type { ParsedLine } from "./mealie/import";
import { loadReview, saveReview } from "./recipe-review";

/*
 * Contract for `loadReview(slug, deps?)` and `saveReview(slug, input, deps?)`
 * that these tests pin down. Every dep is optional and defaults to the real
 * thing. Both functions take the same `Deps` type (each uses the ones it needs).
 *
 *   getRecipe(slug)   -> RawRecipe | null      (null: unknown slug)
 *       the raw Mealie recipe (GET /api/recipes/{slug}) cut down to:
 *       { name: string,
 *         recipeServings?: number | null,        (0 or null = not set)
 *         orgURL?: string | null,                ("" = none)
 *         nutrition?: Record<string, string | null> | null,
 *         extras?: Record<string, unknown> | null,
 *         recipeIngredient?: Array<{
 *           referenceId?: string | null, originalText?: string | null,
 *           note?: string | null, display?: string | null,
 *           title?: string | null, quantity?: number | null,
 *           unit?: { id?: string | null, name: string } | null,
 *           food?: { id?: string | null, name: string } | null }> | null }
 *       Raw, not the cached `Recipe` model, because that drops extras and the
 *       other nutrition fields (same reason as importRecipe's getRecipe).
 *   parse(lines)      -> ParsedLine[]          (parseIngredients; same order)
 *   groupSlug()       -> Promise<string>       (GET /api/groups/self, cached per
 *                        process by the default; the test dep is uncached)
 *   publicUrl         -> string | null         (MEALIE_PUBLIC_URL; a value, not a
 *                        function; may end in a slash)
 *   findOrCreateFood(name) / findOrCreateUnit(name) -> { id, name }
 *   patch(slug, fields) -> void                (patchRecipe)
 *   refresh(slug)     -> void                  (loadRecipes(db, [slug], { force: true }))
 *
 * loadReview:
 * - A raw ingredient counts as already parsed when its food or unit has an id;
 *   all other lines go to `parse` in ONE call, as their `original` text, in
 *   order. `parse` is not called at all when there is nothing to parse.
 * - original = originalText || note || display; key = referenceId || String(index).
 * - Parsed lines: quantity 0 -> null, confidence null, asText false.
 *   Parser lines: asText = (food === null), confidence from the parser.
 * - nutrition per macro as normaliseNutrition reads it (unreadable -> null).
 * - mealieUrl = `${publicUrl without trailing slash}/g/${groupSlug}/r/${slug}`,
 *   null without publicUrl (and groupSlug is then not called).
 * - importState = readImportState(extras).
 *
 * saveReview:
 * - Input validation (servings > 0, macros >= 0 or null, <= 200 lines) is the
 *   action's zod schema (`reviewInputSchema`, tested in domain/review-input.test.ts),
 *   not repeated here.
 * - A lines is note-only when asText is true or food is null/blank:
 *   { title, quantity: 0, note }. Other lines:
 *   { title, quantity: quantity ?? 0, unit: {id,name} | null, food: {id,name}, note }.
 * - Distinct names are resolved once each (trimmed, case-insensitive key),
 *   units and foods separately; note-only lines resolve nothing.
 * - One `patch(slug, { recipeServings, nutrition, recipeIngredient, extras })`.
 *   `nutrition` is the recipe's existing nutrition with the five mapped
 *   fields overwritten (calories, proteinContent, carbohydrateContent,
 *   fatContent, fiberContent) as strings, null staying null.
 * - A recipe that no longer exists -> UserFacingError, nothing patched.
 * - Mealie down (a MealieError 5xx/429 or MealieUnavailableError from any dep)
 *   -> RetryableError; other errors pass through.
 */

type Deps = NonNullable<Parameters<typeof loadReview>[1]>;
type SaveDeps = NonNullable<Parameters<typeof saveReview>[2]>;
type SaveInput = Parameters<typeof saveReview>[1];
type Raw = NonNullable<Awaited<ReturnType<NonNullable<Deps["getRecipe"]>>>>;
type Parse = NonNullable<Deps["parse"]>;

function parsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return {
    input: "",
    quantity: null,
    unit: null,
    food: null,
    note: "",
    confidence: 1,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Deps & SaveDeps> = {}) {
  const getRecipe = vi
    .fn<NonNullable<Deps["getRecipe"]>>()
    .mockResolvedValue({ name: "Soup", recipeIngredient: [] });
  const parse = vi.fn<Parse>().mockResolvedValue([]);
  const groupSlug = vi
    .fn<NonNullable<Deps["groupSlug"]>>()
    .mockResolvedValue("home");
  const findOrCreateFood = vi
    .fn<NonNullable<SaveDeps["findOrCreateFood"]>>()
    .mockImplementation((name) =>
      Promise.resolve({ id: `food-${name.trim().toLowerCase()}`, name })
    );
  const findOrCreateUnit = vi
    .fn<NonNullable<SaveDeps["findOrCreateUnit"]>>()
    .mockImplementation((name) =>
      Promise.resolve({ id: `unit-${name.trim().toLowerCase()}`, name })
    );
  const patch = vi
    .fn<NonNullable<SaveDeps["patch"]>>()
    .mockResolvedValue(undefined);
  const refresh = vi
    .fn<NonNullable<SaveDeps["refresh"]>>()
    .mockResolvedValue(undefined);
  const deps: Deps & SaveDeps = {
    getRecipe,
    parse,
    groupSlug,
    publicUrl: "https://mealie.example.com",
    findOrCreateFood,
    findOrCreateUnit,
    patch,
    refresh,
    ...overrides,
  };
  return {
    deps,
    getRecipe,
    parse,
    groupSlug,
    findOrCreateFood,
    findOrCreateUnit,
    patch,
    refresh,
  };
}

function recipe(overrides: Partial<Raw> = {}): Raw {
  return { name: "Soup", recipeIngredient: [], ...overrides };
}

describe("loadReview", () => {
  it("returns null for an unknown slug", async () => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(null);

    await expect(loadReview("nope", deps)).resolves.toBeNull();
    expect(getRecipe).toHaveBeenCalledWith("nope");
    expect(parse).not.toHaveBeenCalled();
  });

  it("maps the recipe's name, servings, source and import state", async () => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        name: "Lentil soup",
        recipeServings: 4,
        orgURL: "https://example.com/soup",
        extras: { scrappyReview: "pending", scrappyNutrition: "source" },
      })
    );

    const draft = await loadReview("lentil-soup", deps);

    expect(draft).toMatchObject({
      slug: "lentil-soup",
      name: "Lentil soup",
      servings: 4,
      sourceUrl: "https://example.com/soup",
      importState: { review: "pending", nutrition: "source" },
    });
  });

  it.each([
    ["0", 0],
    ["null", null],
    ["missing", undefined],
  ])("reports servings as null when Mealie has %s", async (_l, servings) => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(recipe({ recipeServings: servings }));

    expect((await loadReview("soup", deps))?.servings).toBeNull();
  });

  it("reports an empty source URL as null and a recipe without extras as done", async () => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(recipe({ orgURL: "", extras: null }));

    const draft = await loadReview("soup", deps);

    expect(draft?.sourceUrl).toBeNull();
    expect(draft?.importState).toEqual({ review: "done", nutrition: null });
  });

  it("reads nutrition into numbers and leaves unreadable values null", async () => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        nutrition: {
          calories: "320 kcal",
          proteinContent: "12,5",
          carbohydrateContent: "10-12",
          fatContent: "",
          fiberContent: "3 mg",
          sodiumContent: "400",
        },
      })
    );

    expect((await loadReview("soup", deps))?.nutrition).toEqual({
      kcal: 320,
      protein: 12.5,
      carbs: null,
      fat: null,
      fibre: null,
    });
  });

  it("reads missing nutrition as all null", async () => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(recipe({ nutrition: null }));

    expect((await loadReview("soup", deps))?.nutrition).toEqual({
      kcal: null,
      protein: null,
      carbs: null,
      fat: null,
      fibre: null,
    });
  });

  describe("ingredient lines", () => {
    it("sends only unparsed lines to the parser, in one call, in order", async () => {
      const { deps, getRecipe, parse } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            { referenceId: "a", originalText: "200 g red lentils", note: "x" },
            {
              referenceId: "b",
              quantity: 2,
              unit: { id: "u1", name: "cup" },
              food: { id: "f1", name: "flour" },
              note: "sifted",
            },
            { referenceId: "c", note: "a squeeze of lemon" },
            { referenceId: "d", display: "1 onion" },
          ],
        })
      );
      parse.mockResolvedValue([parsedLine(), parsedLine(), parsedLine()]);

      await loadReview("soup", deps);

      expect(parse).toHaveBeenCalledTimes(1);
      expect(parse).toHaveBeenCalledWith([
        "200 g red lentils",
        "a squeeze of lemon",
        "1 onion",
      ]);
    });

    it("does not call the parser when every line is already parsed", async () => {
      const { deps, getRecipe, parse } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            { quantity: 1, food: { id: "f1", name: "flour" }, note: "" },
            { quantity: 1, unit: { id: "u1", name: "cup" }, note: "" },
          ],
        })
      );

      await loadReview("soup", deps);

      expect(parse).not.toHaveBeenCalled();
    });

    it("keeps already-parsed lines as they are, with no confidence", async () => {
      const { deps, getRecipe } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            {
              referenceId: "ref-1",
              originalText: "2 cups flour, sifted",
              quantity: 2,
              unit: { id: "u1", name: "cup" },
              food: { id: "f1", name: "flour" },
              note: "sifted",
              title: "Dough",
            },
          ],
        })
      );

      const draft = await loadReview("soup", deps);

      expect(draft?.lines).toEqual([
        {
          key: "ref-1",
          original: "2 cups flour, sifted",
          title: "Dough",
          quantity: 2,
          unit: "cup",
          food: "flour",
          note: "sifted",
          confidence: null,
          asText: false,
        },
      ]);
    });

    it("maps parser results onto the unparsed lines and interleaves them in order", async () => {
      const { deps, getRecipe, parse } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            { referenceId: "a", originalText: "200 g red lentils" },
            {
              referenceId: "b",
              quantity: 1,
              food: { id: "f1", name: "onion" },
              note: "",
            },
            { referenceId: "c", note: "a squeeze of lemon", title: "Finish" },
          ],
        })
      );
      parse.mockResolvedValue([
        parsedLine({
          input: "200 g red lentils",
          quantity: 200,
          unit: { id: null, name: "gram" },
          food: { id: null, name: "red lentils" },
          note: "",
          confidence: 0.95,
        }),
        parsedLine({
          input: "a squeeze of lemon",
          note: "a squeeze of lemon",
          confidence: 0.4,
        }),
      ]);

      const draft = await loadReview("soup", deps);

      expect(draft?.lines).toEqual([
        {
          key: "a",
          original: "200 g red lentils",
          title: null,
          quantity: 200,
          unit: "gram",
          food: "red lentils",
          note: "",
          confidence: 0.95,
          asText: false,
        },
        {
          key: "b",
          original: "onion",
          title: null,
          quantity: 1,
          unit: null,
          food: "onion",
          note: "",
          confidence: null,
          asText: false,
        },
        {
          key: "c",
          original: "a squeeze of lemon",
          title: "Finish",
          quantity: null,
          unit: null,
          food: null,
          note: "a squeeze of lemon",
          confidence: 0.4,
          asText: true,
        },
      ]);
    });

    it("sets asText when the parser found no food, even with an amount", async () => {
      const { deps, getRecipe, parse } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({ recipeIngredient: [{ note: "3 pinches" }] })
      );
      parse.mockResolvedValue([
        parsedLine({ quantity: 3, note: "pinches", confidence: 0.6 }),
      ]);

      const draft = await loadReview("soup", deps);

      expect(draft?.lines[0]).toMatchObject({ asText: true, quantity: 3 });
    });

    it("falls back from originalText to note to display for the original, and to the index for the key", async () => {
      const { deps, getRecipe, parse } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            { originalText: "from original", note: "n", display: "d" },
            { originalText: "", note: "from note", display: "d" },
            { originalText: null, note: "", display: "from display" },
          ],
        })
      );
      parse.mockResolvedValue([parsedLine(), parsedLine(), parsedLine()]);

      const draft = await loadReview("soup", deps);

      expect(draft?.lines.map((l) => [l.key, l.original])).toEqual([
        ["0", "from original"],
        ["1", "from note"],
        ["2", "from display"],
      ]);
      expect(parse).toHaveBeenCalledWith([
        "from original",
        "from note",
        "from display",
      ]);
    });

    it("turns a parsed line's quantity of 0 into null", async () => {
      const { deps, getRecipe } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          recipeIngredient: [
            { quantity: 0, food: { id: "f1", name: "salt" }, note: "" },
          ],
        })
      );

      expect((await loadReview("soup", deps))?.lines[0].quantity).toBeNull();
    });
  });

  describe("link to Mealie", () => {
    it("is the public URL plus the group slug and recipe slug", async () => {
      const { deps, groupSlug } = makeDeps({
        publicUrl: "https://mealie.example.com",
      });
      groupSlug.mockResolvedValue("home");

      expect((await loadReview("soup", deps))?.mealieUrl).toBe(
        "https://mealie.example.com/g/home/r/soup"
      );
    });

    it("ignores a trailing slash on the public URL", async () => {
      const { deps } = makeDeps({ publicUrl: "https://mealie.example.com/" });

      expect((await loadReview("soup", deps))?.mealieUrl).toBe(
        "https://mealie.example.com/g/home/r/soup"
      );
    });

    it("is null without a public URL, without asking Mealie for the group", async () => {
      const { deps, groupSlug } = makeDeps({ publicUrl: null });

      expect((await loadReview("soup", deps))?.mealieUrl).toBeNull();
      expect(groupSlug).not.toHaveBeenCalled();
    });
  });
});

const NO_NUTRITION = {
  kcal: null,
  protein: null,
  carbs: null,
  fat: null,
  fibre: null,
};

function input(overrides: Partial<SaveInput> = {}): SaveInput {
  return { servings: 4, nutrition: NO_NUTRITION, lines: [], ...overrides };
}

function line(
  overrides: Partial<SaveInput["lines"][number]> = {}
): SaveInput["lines"][number] {
  return {
    title: null,
    asText: false,
    quantity: null,
    unit: null,
    food: null,
    note: "",
    ...overrides,
  };
}

describe("saveReview", () => {
  it("makes one patch with servings, nutrition, ingredients and extras, then refreshes", async () => {
    const { deps, getRecipe, patch, refresh } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ extras: { scrappyReview: "pending" } })
    );

    await saveReview(
      "soup",
      input({
        servings: 2,
        nutrition: { kcal: 320, protein: 12.5, carbs: 40, fat: 0, fibre: null },
        lines: [
          line({
            quantity: 200,
            unit: "gram",
            food: "red lentils",
            note: "rinsed",
            title: "Soup",
          }),
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("soup", {
      recipeServings: 2,
      nutrition: {
        calories: "320",
        proteinContent: "12.5",
        carbohydrateContent: "40",
        fatContent: "0",
        fiberContent: null,
      },
      recipeIngredient: [
        {
          title: "Soup",
          quantity: 200,
          unit: { id: "unit-gram", name: "gram" },
          food: { id: "food-red lentils", name: "red lentils" },
          note: "rinsed",
        },
      ],
      extras: { scrappyReview: "done", scrappyNutrition: "reviewed" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("soup");
  });

  it("refreshes only after the patch", async () => {
    const { deps, patch, refresh } = makeDeps();
    const order: string[] = [];
    patch.mockImplementation(() => {
      order.push("patch");
      return Promise.resolve();
    });
    refresh.mockImplementation(() => {
      order.push("refresh");
      return Promise.resolve();
    });

    await saveReview("soup", input(), deps);

    expect(order).toEqual(["patch", "refresh"]);
  });

  it("keeps Mealie's other nutrition fields", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        nutrition: {
          calories: "999",
          sodiumContent: "400",
          sugarContent: "5",
        },
      })
    );

    await saveReview(
      "soup",
      input({ nutrition: { ...NO_NUTRITION, kcal: 320 } }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        nutrition: expect.objectContaining({
          calories: "320",
          proteinContent: null,
          sodiumContent: "400",
          sugarContent: "5",
        }),
      })
    );
  });

  it("turns asText lines and lines without a food into note-only ingredients", async () => {
    const { deps, patch, findOrCreateFood, findOrCreateUnit } = makeDeps();

    await saveReview(
      "soup",
      input({
        lines: [
          line({
            asText: true,
            quantity: 3,
            unit: "gram",
            food: "salt",
            note: "salt to taste",
            title: "Seasoning",
          }),
          line({ quantity: 2, unit: "cup", food: null, note: "a squeeze" }),
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [
          { title: "Seasoning", quantity: 0, note: "salt to taste" },
          { title: null, quantity: 0, note: "a squeeze" },
        ],
      })
    );
    expect(findOrCreateFood).not.toHaveBeenCalled();
    expect(findOrCreateUnit).not.toHaveBeenCalled();
  });

  it("resolves each distinct unit and food once, case-insensitively, keeping line order", async () => {
    const { deps, patch, findOrCreateFood, findOrCreateUnit } = makeDeps();

    await saveReview(
      "soup",
      input({
        lines: [
          line({ quantity: 1, unit: "Cup", food: "Flour" }),
          line({ quantity: 2, unit: "cup ", food: "sugar" }),
          line({ quantity: 3, unit: null, food: " flour" }),
          line({ quantity: 4, unit: "tbsp", food: "Sugar" }),
        ],
      }),
      deps
    );

    expect(findOrCreateUnit).toHaveBeenCalledTimes(2);
    expect(findOrCreateFood).toHaveBeenCalledTimes(2);
    const [, fields] = patch.mock.calls[0];
    expect(
      fields.recipeIngredient?.map((i) => [i.quantity, i.unit, i.food])
    ).toEqual([
      [
        1,
        expect.objectContaining({ id: "unit-cup" }),
        expect.objectContaining({ id: "food-flour" }),
      ],
      [
        2,
        expect.objectContaining({ id: "unit-cup" }),
        expect.objectContaining({ id: "food-sugar" }),
      ],
      [3, null, expect.objectContaining({ id: "food-flour" })],
      [
        4,
        expect.objectContaining({ id: "unit-tbsp" }),
        expect.objectContaining({ id: "food-sugar" }),
      ],
    ]);
  });

  it("writes a missing amount as 0", async () => {
    const { deps, patch } = makeDeps();

    await saveReview(
      "soup",
      input({ lines: [line({ quantity: null, food: "salt" })] }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [expect.objectContaining({ quantity: 0 })],
      })
    );
  });

  describe("import state", () => {
    it("marks nutrition as reviewed when any macro is set, and keeps other extras", async () => {
      const { deps, getRecipe, patch } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          extras: {
            note: "from the site",
            scrappyReview: "pending",
            scrappyNutrition: "estimated",
          },
        })
      );

      await saveReview(
        "soup",
        input({ nutrition: { ...NO_NUTRITION, fibre: 0 } }),
        deps
      );

      expect(patch).toHaveBeenCalledWith(
        "soup",
        expect.objectContaining({
          extras: {
            note: "from the site",
            scrappyReview: "done",
            scrappyNutrition: "reviewed",
          },
        })
      );
    });

    it("removes scrappyNutrition when no macro is set", async () => {
      const { deps, getRecipe, patch } = makeDeps();
      getRecipe.mockResolvedValue(
        recipe({
          extras: {
            note: "keep",
            scrappyReview: "pending",
            scrappyNutrition: "estimated",
          },
        })
      );

      await saveReview("soup", input(), deps);

      expect(patch).toHaveBeenCalledWith(
        "soup",
        expect.objectContaining({
          extras: { note: "keep", scrappyReview: "done" },
        })
      );
    });

    it("works for a recipe without extras", async () => {
      const { deps, getRecipe, patch } = makeDeps();
      getRecipe.mockResolvedValue(recipe({ extras: null }));

      await saveReview("soup", input(), deps);

      expect(patch).toHaveBeenCalledWith(
        "soup",
        expect.objectContaining({ extras: { scrappyReview: "done" } })
      );
    });
  });

  it("says so when the recipe no longer exists, without patching", async () => {
    const { deps, getRecipe, patch, refresh } = makeDeps();
    getRecipe.mockResolvedValue(null);

    const error = await saveReview("gone", input(), deps).catch(
      (e: unknown) => e
    );

    expect(error).toBeInstanceOf(UserFacingError);
    expect(error).not.toBeInstanceOf(RetryableError);
    expect(patch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh when the patch fails, and passes the error on", async () => {
    const { deps, patch, refresh } = makeDeps();
    const boom = new Error("disk full");
    patch.mockRejectedValue(boom);

    await expect(saveReview("soup", input(), deps)).rejects.toBe(boom);
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("when Mealie doesn't answer", () => {
    const failures: [string, () => Error][] = [
      ["a 500", () => new MealieError(500, "/api/recipes/soup", "boom")],
      ["a 503", () => new MealieError(503, "/api/recipes/soup", "down")],
      ["a 429", () => new MealieError(429, "/api/recipes/soup", "slow down")],
      [
        "Mealie unreachable (refused or timed out)",
        () =>
          new MealieUnavailableError("Mealie unreachable", {
            cause: new TypeError("fetch failed"),
          }),
      ],
    ];
    const withLine = input({
      lines: [line({ quantity: 1, unit: "cup", food: "flour" })],
    });

    it.each(failures)(
      "turns %s while patching into a RetryableError, without refreshing",
      async (_l, make) => {
        const { deps, patch, refresh } = makeDeps();
        patch.mockRejectedValue(make());

        const error = await saveReview("soup", withLine, deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(RetryableError);
        expect(refresh).not.toHaveBeenCalled();
      }
    );

    it.each(failures)(
      "turns %s while creating a food into a RetryableError, without patching",
      async (_l, make) => {
        const { deps, findOrCreateFood, patch } = makeDeps();
        findOrCreateFood.mockRejectedValue(make());

        const error = await saveReview("soup", withLine, deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(RetryableError);
        expect(patch).not.toHaveBeenCalled();
      }
    );

    it.each(failures)(
      "turns %s while creating a unit into a RetryableError, without patching",
      async (_l, make) => {
        const { deps, findOrCreateUnit, patch } = makeDeps();
        findOrCreateUnit.mockRejectedValue(make());

        const error = await saveReview("soup", withLine, deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(RetryableError);
        expect(patch).not.toHaveBeenCalled();
      }
    );

    it.each(failures)(
      "turns %s while reading the recipe into a RetryableError",
      async (_l, make) => {
        const { deps, getRecipe, patch } = makeDeps();
        getRecipe.mockRejectedValue(make());

        const error = await saveReview("soup", withLine, deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(RetryableError);
        expect(patch).not.toHaveBeenCalled();
      }
    );

    it("does not hide a client error (4xx) as retryable", async () => {
      const { deps, patch } = makeDeps();
      patch.mockRejectedValue(
        new MealieError(422, "/api/recipes/soup", "bad body")
      );

      const error = await saveReview("soup", withLine, deps).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(MealieError);
      expect(error).not.toBeInstanceOf(RetryableError);
    });
  });
});

describe("hidden ingredient fields", () => {
  const stored = {
    referenceId: "ref-1",
    originalText: "2 cups flour, sifted",
    quantity: 2,
    unit: { id: "u1", name: "cup" },
    food: { id: "f1", name: "flour" },
    note: "sifted",
    substitutions: [{ note: "or spelt" }],
  };

  it("carries referenceId, originalText and substitutions over from Mealie's ingredient", async () => {
    const { deps, getRecipe, patch, findOrCreateFood, findOrCreateUnit } =
      makeDeps();
    getRecipe.mockResolvedValue(recipe({ recipeIngredient: [stored] }));

    await saveReview(
      "soup",
      input({
        lines: [
          {
            ...line({ quantity: 3, unit: "cup", food: "flour", note: "x" }),
            referenceId: "ref-1",
          },
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [
          {
            title: null,
            quantity: 3,
            unit: { id: "u1", name: "cup" },
            food: { id: "f1", name: "flour" },
            note: "x",
            referenceId: "ref-1",
            originalText: "2 cups flour, sifted",
            substitutions: [{ note: "or spelt" }],
          },
        ],
      })
    );
    // Names unchanged: Mealie's own ids are kept, nothing is looked up.
    expect(findOrCreateFood).not.toHaveBeenCalled();
    expect(findOrCreateUnit).not.toHaveBeenCalled();
  });

  it("sets originalText to the displayed line when Mealie had none", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ recipeIngredient: [{ referenceId: "ref-2", note: "1 onion" }] })
    );

    await saveReview(
      "soup",
      input({
        lines: [
          { ...line({ asText: true, note: "1 onion" }), referenceId: "ref-2" },
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [
          expect.objectContaining({
            referenceId: "ref-2",
            originalText: "1 onion",
          }),
        ],
      })
    );
  });

  it("looks up a renamed food instead of keeping the stored id", async () => {
    const { deps, getRecipe, findOrCreateFood } = makeDeps();
    getRecipe.mockResolvedValue(recipe({ recipeIngredient: [stored] }));

    await saveReview(
      "soup",
      input({
        lines: [
          { ...line({ quantity: 1, food: "rye flour" }), referenceId: "ref-1" },
        ],
      }),
      deps
    );

    expect(findOrCreateFood).toHaveBeenCalledWith("rye flour");
  });

  it("ignores a reference id Mealie doesn't have", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(recipe({ recipeIngredient: [stored] }));

    await saveReview(
      "soup",
      input({
        lines: [{ ...line({ asText: true, note: "x" }), referenceId: "other" }],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [{ title: null, quantity: 0, note: "x" }],
      })
    );
  });

  it("does not send a linked-recipe line to the parser", async () => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        recipeIngredient: [
          { referenceId: "a", note: "Dough", referencedRecipe: { id: "r9" } },
        ],
      })
    );

    const draft = await loadReview("soup", deps);

    expect(parse).not.toHaveBeenCalled();
    expect(draft?.lines[0]).toMatchObject({ confidence: null, asText: false });
  });
});

describe("nutrition Mealie holds as text", () => {
  it("keeps unreadable text when the field is left empty, and shows it", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ nutrition: { calories: "10-12", fatContent: "3 mg" } })
    );

    const draft = await loadReview("soup", deps);
    expect(draft?.unreadableNutrition).toEqual({ kcal: "10-12", fat: "3 mg" });

    await saveReview(
      "soup",
      input({ nutrition: { ...NO_NUTRITION, protein: 9 } }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        nutrition: expect.objectContaining({
          calories: "10-12",
          fatContent: "3 mg",
          proteinContent: "9",
        }),
      })
    );
  });
});

describe("a short answer from the parser", () => {
  it("leaves the lines it didn't answer for as text", async () => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ recipeIngredient: [{ note: "1 onion" }, { note: "salt" }] })
    );
    parse.mockResolvedValue([
      parsedLine({ food: { id: null, name: "onion" } }),
    ]);

    const draft = await loadReview("soup", deps);

    expect(draft?.lines[1]).toMatchObject({
      original: "salt",
      food: null,
      note: "salt",
      asText: true,
    });
  });
});

describe("a row with no text", () => {
  it("is shown as text without a warning", async () => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        recipeIngredient: [
          { title: "For the sauce", note: "" },
          { note: "salt" },
        ],
      })
    );
    parse.mockResolvedValue([parsedLine()]);

    const draft = await loadReview("soup", deps);

    expect(parse).toHaveBeenCalledWith(["salt"]);
    expect(draft?.lines[0]).toMatchObject({
      title: "For the sauce",
      asText: true,
      confidence: null,
    });
  });
});

describe("loadReview after the recipe was reviewed", () => {
  const lines = [
    {
      referenceId: "a",
      originalText: "1 onion, chopped",
      note: "1 onion, chopped",
    },
    {
      referenceId: "b",
      quantity: 1,
      food: { id: "f1", name: "flour" },
      note: "",
    },
  ];

  it("loads unparsed lines as text without asking the parser", async () => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        extras: { scrappyReview: "done" },
        recipeIngredient: lines,
      })
    );

    const draft = await loadReview("soup", deps);

    expect(parse).not.toHaveBeenCalled();
    expect(draft?.lines[0]).toEqual({
      key: "a",
      original: "1 onion, chopped",
      title: null,
      quantity: null,
      unit: null,
      food: null,
      note: "1 onion, chopped",
      confidence: null,
      asText: true,
    });
    expect(draft?.lines[1]).toMatchObject({ food: "flour", asText: false });
  });

  it.each([
    ["pending", { scrappyReview: "pending" }],
    ["no key", {}],
  ])("still parses unparsed lines when review is %s", async (_l, extras) => {
    const { deps, getRecipe, parse } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ extras, recipeIngredient: [lines[0]] })
    );
    parse.mockResolvedValue([
      parsedLine({ food: { id: null, name: "onion" } }),
    ]);

    await loadReview("soup", deps);

    expect(parse).toHaveBeenCalledWith(["1 onion, chopped"]);
  });
});

describe("linked recipes and parsed lines on save", () => {
  it("copies a linked-recipe line back as stored, whatever was submitted", async () => {
    const { deps, getRecipe, patch, findOrCreateFood } = makeDeps();
    const linked = {
      referenceId: "ref-l",
      quantity: 2,
      note: "stored note",
      originalText: "Dough",
      referencedRecipe: { id: "r9", name: "Dough" },
    };
    getRecipe.mockResolvedValue(recipe({ recipeIngredient: [linked] }));

    await saveReview(
      "soup",
      input({
        lines: [
          {
            ...line({ quantity: 9, food: "evil", unit: "kg", note: "changed" }),
            referenceId: "ref-l",
          },
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({ recipeIngredient: [linked] })
    );
    expect(findOrCreateFood).not.toHaveBeenCalled();
  });

  it("does not invent originalText for a line Mealie had parsed", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        recipeIngredient: [
          {
            referenceId: "ref-p",
            quantity: 1,
            food: { id: "f1", name: "flour" },
            note: "",
          },
        ],
      })
    );

    await saveReview(
      "soup",
      input({
        lines: [
          { ...line({ quantity: 1, food: "flour" }), referenceId: "ref-p" },
        ],
      }),
      deps
    );

    expect(patch).toHaveBeenCalledWith(
      "soup",
      expect.objectContaining({
        recipeIngredient: [
          expect.objectContaining({ referenceId: "ref-p", originalText: null }),
        ],
      })
    );
  });

  it("gives a repeated reference id to the first line only", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({ recipeIngredient: [{ referenceId: "dup", note: "salt" }] })
    );
    const l = { ...line({ asText: true, note: "salt" }), referenceId: "dup" };

    await saveReview("soup", input({ lines: [l, l] }), deps);

    const [, fields] = patch.mock.calls[0];
    expect(fields.recipeIngredient?.map((i) => i.referenceId)).toEqual([
      "dup",
      undefined,
    ]);
  });

  it("marks a linked-recipe line as linked when loading", async () => {
    const { deps, getRecipe } = makeDeps();
    getRecipe.mockResolvedValue(
      recipe({
        recipeIngredient: [
          { referenceId: "a", note: "Dough", referencedRecipe: { id: "r9" } },
        ],
      })
    );

    expect((await loadReview("soup", deps))?.lines[0].linked).toBe(true);
  });
});

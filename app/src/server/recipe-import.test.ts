import { describe, expect, it, vi } from "vitest";

import { UserFacingError } from "./errors";
import { MealieError } from "./mealie/client";
import { importRecipe } from "./recipe-import";

/*
 * Contract for `importRecipe(url, userId, deps?)` that these tests pin down.
 * Every dep is optional and defaults to the real thing (find: findRecipeBySourceUrl,
 * importFromUrl: importRecipeFromUrl, patch: patchRecipe, limiter: a
 * createRateLimiter of 20 per hour, getRecipe: a Mealie GET of the recipe).
 *
 *   find(url)            -> { slug, name } | null
 *   importFromUrl(url)   -> slug | null            (null: Mealie found no recipe)
 *   getRecipe(slug)      -> { nutrition?: Record<string, string | null> | null,
 *                             extras?: Record<string, unknown> | null } | null
 *                           i.e. the raw Mealie recipe fields the import needs.
 *                           "Has nutrition" = at least one nutrition value that is
 *                           a non-empty string.
 *   patch(slug, fields)  -> void; called once with { extras } and nothing else
 *   limiter              -> { hit(key: string): boolean }; false = over the limit.
 *                           Called with the userId, before find/importFromUrl.
 */

type Deps = NonNullable<Parameters<typeof importRecipe>[2]>;

const URL_ = "https://example.com/soup";

function makeDeps(overrides: Partial<Deps> = {}) {
  const find = vi.fn<NonNullable<Deps["find"]>>().mockResolvedValue(null);
  const importFromUrl = vi
    .fn<NonNullable<Deps["importFromUrl"]>>()
    .mockResolvedValue("soup");
  const getRecipe = vi
    .fn<NonNullable<Deps["getRecipe"]>>()
    .mockResolvedValue({ nutrition: null, extras: {} });
  const patch = vi
    .fn<NonNullable<Deps["patch"]>>()
    .mockResolvedValue(undefined);
  const hit = vi.fn<(key: string) => boolean>().mockReturnValue(true);
  const deps: Deps = {
    find,
    importFromUrl,
    getRecipe,
    patch,
    limiter: { hit },
    ...overrides,
  };
  return { deps, find, importFromUrl, getRecipe, patch, hit };
}

describe("importRecipe", () => {
  it("links to a recipe already imported from the URL without importing", async () => {
    const { deps, find, importFromUrl, patch } = makeDeps();
    find.mockResolvedValue({ slug: "old-soup", name: "Old soup" });

    await expect(importRecipe(URL_, "u1", deps)).resolves.toEqual({
      status: "exists",
      slug: "old-soup",
      name: "Old soup",
    });
    expect(find).toHaveBeenCalledWith(URL_);
    expect(importFromUrl).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("imports, then marks the recipe pending with nutrition from the source", async () => {
    const { deps, importFromUrl, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({
      nutrition: { calories: "320", proteinContent: null, fatContent: "" },
      extras: {},
    });

    await expect(importRecipe(URL_, "u1", deps)).resolves.toEqual({
      status: "imported",
      slug: "soup",
    });
    expect(importFromUrl).toHaveBeenCalledWith(URL_);
    expect(getRecipe).toHaveBeenCalledWith("soup");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("soup", {
      extras: { scrappyReview: "pending", scrappyNutrition: "source" },
    });
  });

  it.each([
    ["null nutrition", null],
    ["no nutrition key", undefined],
    ["only empty values", { calories: null, fatContent: "" }],
  ])("leaves scrappyNutrition out with %s", async (_label, nutrition) => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({ nutrition, extras: {} });

    await importRecipe(URL_, "u1", deps);

    expect(patch).toHaveBeenCalledWith("soup", {
      extras: { scrappyReview: "pending" },
    });
  });

  it("keeps other string extras the imported recipe already has", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({
      nutrition: { calories: "100" },
      extras: { note: "from the site", scrappyReview: "done" },
    });

    await importRecipe(URL_, "u1", deps);

    expect(patch).toHaveBeenCalledWith("soup", {
      extras: {
        note: "from the site",
        scrappyReview: "pending",
        scrappyNutrition: "source",
      },
    });
  });

  it("still marks the recipe pending when the fetched recipe has no extras", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({
      nutrition: { calories: "100" },
      extras: null,
    });

    await importRecipe(URL_, "u1", deps);

    expect(patch).toHaveBeenCalledWith("soup", {
      extras: { scrappyReview: "pending", scrappyNutrition: "source" },
    });
  });

  it("says no recipe was found when Mealie returns none", async () => {
    const { deps, importFromUrl, patch } = makeDeps();
    importFromUrl.mockResolvedValue(null);

    const error = await importRecipe(URL_, "u1", deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect(patch).not.toHaveBeenCalled();
  });

  describe("when Mealie doesn't answer", () => {
    const failures: [string, () => Error][] = [
      ["a 500", () => new MealieError(500, "/api/recipes/create/url", "boom")],
      [
        "a 502",
        () => new MealieError(502, "/api/recipes/create/url", "bad gateway"),
      ],
      [
        "a timeout",
        () =>
          Object.assign(new Error("signal timed out"), {
            name: "TimeoutError",
          }),
      ],
      ["a network failure", () => new TypeError("fetch failed")],
    ];

    it.each(failures)(
      "turns %s during the import into a UserFacingError",
      async (_l, make) => {
        const { deps, importFromUrl } = makeDeps();
        importFromUrl.mockRejectedValue(make());

        const error = await importRecipe(URL_, "u1", deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(UserFacingError);
      }
    );

    it.each(failures)(
      "turns %s during the duplicate check into a UserFacingError",
      async (_l, make) => {
        const { deps, find, importFromUrl } = makeDeps();
        find.mockRejectedValue(make());

        const error = await importRecipe(URL_, "u1", deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(UserFacingError);
        expect(importFromUrl).not.toHaveBeenCalled();
      }
    );

    it.each(failures)(
      "turns %s while marking the recipe into a UserFacingError",
      async (_l, make) => {
        const { deps, patch } = makeDeps();
        patch.mockRejectedValue(make());

        const error = await importRecipe(URL_, "u1", deps).catch(
          (e: unknown) => e
        );

        expect(error).toBeInstanceOf(UserFacingError);
      }
    );
  });

  describe("rate limit", () => {
    it("is counted per user before Mealie is called", async () => {
      const { deps, hit, find } = makeDeps();
      const order: string[] = [];
      hit.mockImplementation(() => {
        order.push("hit");
        return true;
      });
      find.mockImplementation(() => {
        order.push("find");
        return Promise.resolve(null);
      });

      await importRecipe(URL_, "user-42", deps);

      expect(hit).toHaveBeenCalledWith("user-42");
      expect(order[0]).toBe("hit");
    });

    it("throws a UserFacingError over the limit without calling Mealie", async () => {
      const { deps, hit, find, importFromUrl, getRecipe, patch } = makeDeps();
      hit.mockReturnValue(false);

      const error = await importRecipe(URL_, "u1", deps).catch(
        (e: unknown) => e
      );

      expect(error).toBeInstanceOf(UserFacingError);
      expect(find).not.toHaveBeenCalled();
      expect(importFromUrl).not.toHaveBeenCalled();
      expect(getRecipe).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    });

    it("counts an already-imported URL against the limit too", async () => {
      const { deps, hit, find } = makeDeps();
      find.mockResolvedValue({ slug: "old-soup", name: "Old soup" });

      await importRecipe(URL_, "u1", deps);

      expect(hit).toHaveBeenCalledTimes(1);
    });
  });
});

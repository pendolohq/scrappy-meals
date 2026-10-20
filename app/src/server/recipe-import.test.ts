import { describe, expect, it, vi } from "vitest";

import { RetryableError, UserFacingError } from "./errors";
import { MealieError, MealieUnavailableError } from "./mealie/client";
import { importRecipe, importSocialRecipe } from "./recipe-import";

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
 *                           "Has nutrition" = at least one macro field (calories,
 *                           protein, carbs, fat, fibre) that is a non-blank string.
 *   patch(slug, fields)  -> void; called once with { extras }, plus tags and
 *                           categories from the agreed list for a recipe with
 *                           neither yet
 *   limiter              -> { hit(key: string): boolean }; false = over the limit.
 *                           Called with the userId, before find/importFromUrl.
 *
 * An "exists" recipe without scrappyReview is marked pending (an earlier import
 * failed before marking it). Concurrent imports of one URL share one run.
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
    const { deps, find, importFromUrl, getRecipe, patch } = makeDeps();
    find.mockResolvedValue({ slug: "old-soup", name: "Old soup" });
    getRecipe.mockResolvedValue({ extras: { scrappyReview: "done" } });

    await expect(importRecipe(URL_, "u1", deps)).resolves.toEqual({
      status: "exists",
      slug: "old-soup",
      name: "Old soup",
    });
    expect(find).toHaveBeenCalledWith(URL_);
    expect(importFromUrl).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("marks an already-imported recipe pending when an earlier import never did", async () => {
    const { deps, find, importFromUrl, getRecipe, patch } = makeDeps();
    find.mockResolvedValue({ slug: "old-soup", name: "Old soup" });
    getRecipe.mockResolvedValue({ nutrition: null, extras: { note: "x" } });

    await expect(importRecipe(URL_, "u1", deps)).resolves.toMatchObject({
      status: "exists",
      slug: "old-soup",
    });
    expect(importFromUrl).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("old-soup", {
      extras: { note: "x", scrappyReview: "pending" },
    });
  });

  it("imports a page once when it is submitted twice at the same time", async () => {
    const { deps, find, importFromUrl } = makeDeps();
    let finish!: (slug: string) => void;
    importFromUrl.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const first = importRecipe(URL_, "u1", deps);
    const second = importRecipe(URL_, "u2", deps);
    await vi.waitFor(() => expect(importFromUrl).toHaveBeenCalled());
    finish("soup");

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "imported", slug: "soup" },
      { status: "imported", slug: "soup" },
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(importFromUrl).toHaveBeenCalledTimes(1);
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
    ["only blank values", { calories: "  " }],
    ["only non-macro values", { sodiumContent: "300 mg", sugarContent: "4" }],
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
        "Mealie unreachable (refused or timed out)",
        () =>
          new MealieUnavailableError("Mealie unreachable", {
            cause: new TypeError("fetch failed"),
          }),
      ],
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

/*
 * Contract for `importSocialRecipe(input, userId, deps?)`, on top of the deps
 * above (find, getRecipe, patch, limiter behave as for importRecipe):
 *
 *   input                -> { url, caption: string | null, images: File[] }
 *   aiSettings()         -> { aiEnabled, imageProviderEnabled } (Mealie's
 *                           group AI provider settings)       [name suggested]
 *   importFromAi(input)  -> slug | null   (null: Mealie answered 400, found no
 *                           recipe); called with the same { url, caption, images }
 *                                                              [name suggested]
 *   patch(slug, fields)  -> for a fresh import, one call with { extras, orgURL }
 *                           where orgURL is the post URL.
 *
 * Order: rate limit, find (exists: no AI call), aiSettings, importFromAi.
 */

type SocialDeps = NonNullable<Parameters<typeof importSocialRecipe>[2]>;

const POST = "https://www.instagram.com/p/DAbc123/";
const shot = () => new File(["x"], "shot.png", { type: "image/png" });

function makeSocialDeps(overrides: Partial<SocialDeps> = {}) {
  const find = vi.fn<NonNullable<SocialDeps["find"]>>().mockResolvedValue(null);
  const aiSettings = vi
    .fn<NonNullable<SocialDeps["aiSettings"]>>()
    .mockResolvedValue({ aiEnabled: true, imageProviderEnabled: true });
  const importFromAi = vi
    .fn<NonNullable<SocialDeps["importFromAi"]>>()
    .mockResolvedValue("pasta");
  const getRecipe = vi
    .fn<NonNullable<SocialDeps["getRecipe"]>>()
    .mockResolvedValue({ nutrition: null, extras: {} });
  const patch = vi
    .fn<NonNullable<SocialDeps["patch"]>>()
    .mockResolvedValue(undefined);
  const hit = vi.fn<(key: string) => boolean>().mockReturnValue(true);
  const deps: SocialDeps = {
    find,
    aiSettings,
    importFromAi,
    getRecipe,
    patch,
    limiter: { hit },
    ...overrides,
  };
  return { deps, find, aiSettings, importFromAi, getRecipe, patch, hit };
}

describe("tagging an import", () => {
  it("assigns tags and categories from the agreed list", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({
      name: "Salmon tacos",
      nutrition: { proteinContent: "34" },
      extras: {},
      recipeIngredient: [
        { originalText: "2 salmon fillets", note: "" },
        { note: "8 tortillas" },
      ],
      tags: [],
      recipeCategory: [],
    });

    await importRecipe(URL_, "u1", deps);
    expect(patch).toHaveBeenCalledWith("soup", {
      extras: {
        scrappyReview: "pending",
        scrappyNutrition: "source",
      },
      tags: [
        { name: "Dinner", slug: "dinner" },
        { name: "High protein", slug: "high-protein" },
      ],
      recipeCategory: [{ name: "Fish", slug: "fish" }],
    });
  });

  it("keeps tags someone already set", async () => {
    const { deps, getRecipe, patch } = makeDeps();
    getRecipe.mockResolvedValue({
      name: "Salmon tacos",
      extras: {},
      recipeIngredient: [{ note: "2 salmon fillets" }],
      tags: [{ name: "Lunch", slug: "lunch" }],
    });

    await importRecipe(URL_, "u1", deps);
    expect(patch).toHaveBeenCalledWith("soup", {
      extras: { scrappyReview: "pending" },
    });
  });
});

describe("importSocialRecipe", () => {
  it("links to a post already imported without calling the AI", async () => {
    const { deps, find, aiSettings, importFromAi, getRecipe, patch } =
      makeSocialDeps();
    find.mockResolvedValue({ slug: "old-pasta", name: "Old pasta" });
    getRecipe.mockResolvedValue({ extras: { scrappyReview: "done" } });

    await expect(
      importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "u1",
        deps
      )
    ).resolves.toEqual({
      status: "exists",
      slug: "old-pasta",
      name: "Old pasta",
    });
    expect(find).toHaveBeenCalledWith(POST);
    expect(aiSettings).not.toHaveBeenCalled();
    expect(importFromAi).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("marks an already-imported post pending when an earlier attempt never did", async () => {
    const { deps, find, getRecipe, patch, importFromAi } = makeSocialDeps();
    find.mockResolvedValue({ slug: "old-pasta", name: "Old pasta" });
    getRecipe.mockResolvedValue({ nutrition: null, extras: {} });

    await expect(
      importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "u1",
        deps
      )
    ).resolves.toMatchObject({ status: "exists", slug: "old-pasta" });
    expect(importFromAi).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "old-pasta",
      expect.objectContaining({ extras: { scrappyReview: "pending" } })
    );
  });

  it("explains that Mealie has no AI provider when AI is off", async () => {
    const { deps, aiSettings, importFromAi, patch } = makeSocialDeps();
    aiSettings.mockResolvedValue({
      aiEnabled: false,
      imageProviderEnabled: false,
    });

    const error = await importSocialRecipe(
      { url: POST, caption: "Pasta", images: [] },
      "u1",
      deps
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      "Mealie has no AI provider set up. Add one in Mealie's group settings, then try again."
    );
    expect(importFromAi).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("explains that images need an image provider", async () => {
    const { deps, aiSettings, importFromAi } = makeSocialDeps();
    aiSettings.mockResolvedValue({
      aiEnabled: true,
      imageProviderEnabled: false,
    });

    const error = await importSocialRecipe(
      { url: POST, caption: null, images: [shot()] },
      "u1",
      deps
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      "Mealie has no AI provider for images. Paste the caption instead, or pick an image provider in Mealie's group settings."
    );
    expect(importFromAi).not.toHaveBeenCalled();
  });

  it("goes ahead with a caption alone when there is no image provider", async () => {
    const { deps, aiSettings, importFromAi } = makeSocialDeps();
    aiSettings.mockResolvedValue({
      aiEnabled: true,
      imageProviderEnabled: false,
    });

    await expect(
      importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "u1",
        deps
      )
    ).resolves.toEqual({ status: "imported", slug: "pasta" });
    expect(importFromAi).toHaveBeenCalledTimes(1);
  });

  it("passes the URL, caption and screenshots to the AI import", async () => {
    const { deps, importFromAi } = makeSocialDeps();
    const images = [shot(), shot()];

    await importSocialRecipe(
      { url: POST, caption: "Pasta", images },
      "u1",
      deps
    );

    expect(importFromAi).toHaveBeenCalledWith({
      url: POST,
      caption: "Pasta",
      images,
    });
  });

  it("accepts screenshots alone when the image provider is on", async () => {
    const { deps, importFromAi } = makeSocialDeps();

    await expect(
      importSocialRecipe(
        { url: POST, caption: null, images: [shot()] },
        "u1",
        deps
      )
    ).resolves.toEqual({ status: "imported", slug: "pasta" });
    expect(importFromAi).toHaveBeenCalledWith(
      expect.objectContaining({ caption: null })
    );
  });

  it("says no recipe was found when Mealie answers 400", async () => {
    const { deps, importFromAi, patch } = makeSocialDeps();
    importFromAi.mockResolvedValue(null);

    const error = await importSocialRecipe(
      { url: POST, caption: "Hello", images: [] },
      "u1",
      deps
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UserFacingError);
    expect((error as Error).message).toBe(
      "Couldn't find a recipe in that caption or those screenshots."
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("marks the recipe pending and sets orgURL in one PATCH", async () => {
    const { deps, getRecipe, patch } = makeSocialDeps();
    getRecipe.mockResolvedValue({
      nutrition: { calories: "450" },
      extras: { note: "x" },
    });

    await expect(
      importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "u1",
        deps
      )
    ).resolves.toEqual({ status: "imported", slug: "pasta" });

    expect(getRecipe).toHaveBeenCalledWith("pasta");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("pasta", {
      extras: {
        note: "x",
        scrappyReview: "pending",
        scrappyNutrition: "source",
      },
      orgURL: POST,
    });
  });

  it("leaves scrappyNutrition out when the AI found no macros", async () => {
    const { deps, getRecipe, patch } = makeSocialDeps();
    getRecipe.mockResolvedValue({ nutrition: null, extras: {} });

    await importSocialRecipe(
      { url: POST, caption: "Pasta", images: [] },
      "u1",
      deps
    );

    expect(patch).toHaveBeenCalledWith("pasta", {
      extras: { scrappyReview: "pending" },
      orgURL: POST,
    });
  });

  it("imports a post once when it is submitted twice at the same time", async () => {
    const { deps, find, importFromAi } = makeSocialDeps();
    let finish!: (slug: string) => void;
    importFromAi.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );

    const input = { url: POST, caption: "Pasta", images: [] };
    const first = importSocialRecipe(input, "u1", deps);
    const second = importSocialRecipe(input, "u2", deps);
    await vi.waitFor(() => expect(importFromAi).toHaveBeenCalled());
    finish("pasta");

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "imported", slug: "pasta" },
      { status: "imported", slug: "pasta" },
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(importFromAi).toHaveBeenCalledTimes(1);
  });

  describe("when Mealie doesn't answer", () => {
    const failures: [string, () => Error][] = [
      ["a 500", () => new MealieError(500, "/api/recipes/create/ai", "boom")],
      [
        "Mealie unreachable (refused or timed out)",
        () =>
          new MealieUnavailableError("Mealie unreachable", {
            cause: new TypeError("fetch failed"),
          }),
      ],
    ];

    it.each(failures)(
      "throws a RetryableError on %s during the AI import",
      async (_l, make) => {
        const { deps, importFromAi } = makeSocialDeps();
        importFromAi.mockRejectedValue(make());
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

        const error = await importSocialRecipe(
          { url: POST, caption: "Pasta", images: [] },
          "u1",
          deps
        ).catch((e: unknown) => e);

        quiet.mockRestore();
        expect(error).toBeInstanceOf(RetryableError);
      }
    );

    it.each(failures)(
      "throws a RetryableError on %s reading the AI settings",
      async (_l, make) => {
        const { deps, aiSettings, importFromAi } = makeSocialDeps();
        aiSettings.mockRejectedValue(make());
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

        const error = await importSocialRecipe(
          { url: POST, caption: "Pasta", images: [] },
          "u1",
          deps
        ).catch((e: unknown) => e);

        quiet.mockRestore();
        expect(error).toBeInstanceOf(RetryableError);
        expect(importFromAi).not.toHaveBeenCalled();
      }
    );

    it.each(failures)(
      "throws a RetryableError on %s while marking the recipe",
      async (_l, make) => {
        const { deps, patch } = makeSocialDeps();
        patch.mockRejectedValue(make());
        const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

        const error = await importSocialRecipe(
          { url: POST, caption: "Pasta", images: [] },
          "u1",
          deps
        ).catch((e: unknown) => e);

        quiet.mockRestore();
        expect(error).toBeInstanceOf(RetryableError);
      }
    );
  });

  describe("rate limit", () => {
    it("is counted per user before Mealie is called", async () => {
      const { deps, hit, find } = makeSocialDeps();
      const order: string[] = [];
      hit.mockImplementation(() => {
        order.push("hit");
        return true;
      });
      find.mockImplementation(() => {
        order.push("find");
        return Promise.resolve(null);
      });

      await importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "user-42",
        deps
      );

      expect(hit).toHaveBeenCalledWith("user-42");
      expect(order[0]).toBe("hit");
    });

    it("throws a UserFacingError over the limit without calling Mealie", async () => {
      const { deps, hit, find, aiSettings, importFromAi, patch } =
        makeSocialDeps();
      hit.mockReturnValue(false);

      const error = await importSocialRecipe(
        { url: POST, caption: "Pasta", images: [] },
        "u1",
        deps
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UserFacingError);
      expect(find).not.toHaveBeenCalled();
      expect(aiSettings).not.toHaveBeenCalled();
      expect(importFromAi).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    });

    it("shares one budget with importRecipe", async () => {
      // Default limiter (no `limiter` dep): 20 per hour per user, for both kinds.
      const user = `shared-budget-${crypto.randomUUID()}`;
      const web = makeDeps();
      const social = makeSocialDeps();
      const { limiter: _w, ...webDeps } = web.deps;
      const { limiter: _s, ...socialDeps } = social.deps;

      for (let i = 0; i < 10; i++) {
        await importRecipe(`https://example.com/soup-${i}`, user, webDeps);
        await importSocialRecipe(
          {
            url: `https://www.instagram.com/p/${i}/`,
            caption: "x",
            images: [],
          },
          user,
          socialDeps
        );
      }

      const viaWeb = await importRecipe(
        "https://example.com/last",
        user,
        webDeps
      ).catch((e: unknown) => e);
      const viaPost = await importSocialRecipe(
        { url: "https://www.instagram.com/p/last/", caption: "x", images: [] },
        user,
        socialDeps
      ).catch((e: unknown) => e);

      expect(viaWeb).toBeInstanceOf(UserFacingError);
      expect(viaPost).toBeInstanceOf(UserFacingError);
    });
  });
});

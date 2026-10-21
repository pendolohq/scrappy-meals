// Runs against a real Mealie. Uses the admin login to create an API token and
// fixtures, exercises our wrapper with that token, then removes everything.
//
//   MEALIE_TEST_URL=http://localhost:9000 bun run test:integration
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkMealieVersion,
  createMealieClient,
  type MealieClient,
  MealieError,
  unwrap,
} from "./client";
import {
  findOrCreateFood,
  findOrCreateUnit,
  findRecipeBySourceUrl,
  getAiSettings,
  importRecipeFromUrl,
  parseIngredients,
  patchRecipe,
} from "./import";
import { createProductRecipe, findProductByBarcode } from "./products";
import { discoverRecipes, getRecipe, listOrganizers } from "./recipes";

const baseUrl = process.env.MEALIE_TEST_URL;
const run = randomUUID().slice(0, 8);

describe.skipIf(!baseUrl)("Mealie client (live)", () => {
  let admin: MealieClient;
  let client: MealieClient;
  let tokenId: number | undefined;
  const cleanup: Array<() => Promise<unknown>> = [];

  const ids = { food: "", unit: "", fullSlug: "", bareSlug: "" };

  beforeAll(async () => {
    const form = new URLSearchParams({
      username: process.env.MEALIE_TEST_USER ?? "changeme@example.com",
      password: process.env.MEALIE_TEST_PASSWORD ?? "MyPassword",
    });
    const login = await fetch(`${baseUrl}/api/auth/token`, {
      method: "POST",
      body: form,
    });
    if (!login.ok) {
      throw new Error(`admin login failed: ${login.status}`);
    }
    const { access_token } = (await login.json()) as { access_token: string };
    admin = createMealieClient({ baseUrl: baseUrl!, token: access_token });

    // The app authenticates with a long-lived API token, so test with one too.
    const token = unwrap(
      await admin.POST("/api/users/api-tokens", { body: { name: `it-${run}` } })
    );
    tokenId = token.id;
    client = createMealieClient({ baseUrl: baseUrl!, token: token.token });

    const food = unwrap(
      await admin.POST("/api/foods", { body: { name: `it-lentils-${run}` } })
    );
    const unit = unwrap(
      await admin.POST("/api/units", {
        body: { name: `it-gram-${run}`, abbreviation: "g" },
      })
    );
    ids.food = food.id;
    ids.unit = unit.id;
    cleanup.push(() =>
      admin.DELETE("/api/foods/{item_id}", {
        params: { path: { item_id: food.id } },
      })
    );
    cleanup.push(() =>
      admin.DELETE("/api/units/{item_id}", {
        params: { path: { item_id: unit.id } },
      })
    );

    ids.fullSlug = unwrap(
      await admin.POST("/api/recipes", {
        body: { name: `IT Lentil Soup ${run}` },
      })
    );
    ids.bareSlug = unwrap(
      await admin.POST("/api/recipes", {
        body: { name: `IT Plain Toast ${run}` },
      })
    );
    for (const slug of [ids.fullSlug, ids.bareSlug]) {
      cleanup.push(() =>
        admin.DELETE("/api/recipes/{slug}", { params: { path: { slug } } })
      );
    }

    unwrap(
      await admin.PATCH("/api/recipes/{slug}", {
        params: { path: { slug: ids.fullSlug } },
        body: {
          recipeServings: 4,
          nutrition: {
            calories: "420",
            proteinContent: "24",
            carbohydrateContent: "55.5",
            fatContent: "9",
            fiberContent: "14",
          },
          recipeIngredient: [
            {
              quantity: 300,
              food: { id: food.id, name: food.name },
              unit: { id: unit.id, name: unit.name },
              note: "",
            },
            {
              quantity: 0,
              note: "salt to taste",
              originalText: "salt to taste",
              title: "To serve",
            },
          ],
          recipeInstructions: [
            { title: "Soup", text: "Rinse the lentils." },
            { text: "Simmer for 20 minutes." },
          ],
          notes: [{ title: "Freezing", text: "Keeps for 3 months." }],
        },
      })
    );
  });

  afterAll(async () => {
    for (const fn of cleanup.reverse()) {
      await fn().catch(() => undefined);
    }
    if (tokenId !== undefined) {
      await admin.DELETE("/api/users/api-tokens/{token_id}", {
        params: { path: { token_id: tokenId } },
      });
    }
  });

  it("talks to the Mealie version our types were generated from", async () => {
    const v = await checkMealieVersion(client);
    expect(
      v.matches,
      `server ${v.server}, schema ${v.schema}: regenerate with bun run mealie:types`
    ).toBe(true);
  });

  it("rejects a bad token with a MealieError", async () => {
    const bad = createMealieClient({ baseUrl: baseUrl!, token: "nope" });
    const err = await discoverRecipes(
      { tags: [], categories: [], quick: false },
      { client: bad }
    ).catch((e) => e);
    expect(err).toBeInstanceOf(MealieError);
    expect(err.status).toBe(401);
  });

  it("searches recipes", async () => {
    const page = await discoverRecipes(
      { tags: [], categories: [], quick: false, search: `Lentil Soup ${run}` },
      { client }
    );
    expect(page.items.map((r) => r.slug)).toContain(ids.fullSlug);
    const hit = page.items.find((r) => r.slug === ids.fullSlug)!;
    expect(hit.servings).toBe(4);
  });

  it("normalises a full recipe", async () => {
    const r = (await getRecipe(ids.fullSlug, { client }))!;
    expect(r.servings).toBe(4);
    expect(r.nutrition).toEqual({
      perServing: { kcal: 420, protein: 24, carbs: 55.5, fat: 9, fibre: 14 },
      missing: [],
      status: "complete",
    });
    expect(r.ingredients).toHaveLength(2);
    const [lentils, salt] = r.ingredients;
    expect(lentils).toMatchObject({
      quantity: 300,
      food: { id: ids.food },
      unit: { id: ids.unit, abbreviation: "g" },
    });
    expect(salt).toMatchObject({
      quantity: null,
      food: null,
      unit: null,
      title: "To serve",
    });
    expect(salt.display).toContain("salt to taste");
    expect(r.instructions).toEqual([
      { title: "Soup", text: "Rinse the lentils.", ingredientRefs: [] },
      { title: null, text: "Simmer for 20 minutes.", ingredientRefs: [] },
    ]);
    expect(r.notes).toEqual([
      { title: "Freezing", text: "Keeps for 3 months." },
    ]);
  });

  it("flags a recipe without nutrition or servings", async () => {
    const r = (await getRecipe(ids.bareSlug, { client }))!;
    expect(r.nutrition.status).toBe("missing");
    expect(r.servings).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    expect(await getRecipe(`does-not-exist-${run}`, { client })).toBeNull();
  });

  // The planner keys meals by slug and relies on this to follow a rename
  // (recipe-cache.ts): if a Mealie upgrade changes it, this says so.
  it("gives a renamed recipe a new slug, and still finds it by id", async () => {
    const slug = unwrap(
      await admin.POST("/api/recipes", {
        body: { name: `IT Rename ${run}` },
      })
    );
    const before = (await getRecipe(slug, { client }))!;
    unwrap(
      await admin.PATCH("/api/recipes/{slug}", {
        params: { path: { slug } },
        body: { name: `IT Renamed ${run}` },
      })
    );
    const after = (await getRecipe(before.id, { client }))!;
    cleanup.push(() =>
      admin.DELETE("/api/recipes/{slug}", {
        params: { path: { slug: after.slug } },
      })
    );
    expect(after.slug).not.toBe(slug);
    expect(await getRecipe(slug, { client })).toBeNull();
  });

  describe("discovering", () => {
    const tag = { name: `IT Dinner ${run}`, slug: `it-dinner-${run}` };
    const category = { name: `IT Veg ${run}`, slug: `it-veg-${run}` };

    beforeAll(async () => {
      // By name only, as imports and the review page send them: Mealie
      // finds or creates the organizer.
      await patchRecipe(
        ids.fullSlug,
        {
          tags: [{ name: tag.name }],
          recipeCategory: [{ name: category.name }],
          totalTimeSeconds: 20 * 60,
        },
        { client }
      );
      await patchRecipe(
        ids.bareSlug,
        { tags: [{ name: tag.name }], totalTimeSeconds: 31 * 60 },
        { client }
      );
    });

    afterAll(async () => {
      const query = { perPage: -1 };
      const tags = unwrap(
        await admin.GET("/api/organizers/tags", { params: { query } })
      ).items;
      const categories = unwrap(
        await admin.GET("/api/organizers/categories", { params: { query } })
      ).items;
      const idsOf = (
        items: { id?: string | null; slug: string }[],
        slug: string
      ) => items.flatMap((o) => (o.slug === slug && o.id ? [o.id] : []));
      for (const item_id of idsOf(tags, tag.slug)) {
        await admin.DELETE("/api/organizers/tags/{item_id}", {
          params: { path: { item_id } },
        });
      }
      for (const item_id of idsOf(categories, category.slug)) {
        await admin.DELETE("/api/organizers/categories/{item_id}", {
          params: { path: { item_id } },
        });
      }
    });

    it("reads tags, categories and total time on a recipe", async () => {
      const recipe = await getRecipe(ids.fullSlug, { client });
      expect(recipe).toMatchObject({
        tags: [tag],
        categories: [category],
        totalMinutes: 20,
      });
    });

    it("lists organizers with their recipe counts", async () => {
      const { tags, categories } = await listOrganizers({ client });
      expect(tags).toContainEqual({ ...tag, recipeCount: 2 });
      expect(categories).toContainEqual({ ...category, recipeCount: 1 });
    });

    it("filters by tag, category and quick", async () => {
      const slugs = async (filters: Parameters<typeof discoverRecipes>[0]) =>
        (await discoverRecipes(filters, { client })).items.map((r) => r.slug);
      const none = { tags: [], categories: [], quick: false };

      expect((await slugs({ ...none, tags: [tag.slug] })).toSorted()).toEqual(
        [ids.fullSlug, ids.bareSlug].toSorted()
      );
      expect(await slugs({ ...none, tags: [tag.slug], quick: true })).toEqual([
        ids.fullSlug,
      ]);
      expect(
        await slugs({ ...none, tags: [tag.slug], categories: [category.slug] })
      ).toEqual([ids.fullSlug]);
    });

    it("combines a search with the filters", async () => {
      const { items } = await discoverRecipes(
        {
          tags: [tag.slug],
          categories: [],
          quick: false,
          search: "Lentil",
        },
        { client }
      );
      expect(items.map((r) => r.slug)).toEqual([ids.fullSlug]);
    });
  });

  describe("products", () => {
    // A valid EAN-13 that differs on every run.
    const barcodeFor = (seed: string) => {
      const body = `599${seed}`.slice(0, 12).padEnd(12, "0");
      const sum = [...body].reduce(
        (t, c, i) => t + Number(c) * (i % 2 === 0 ? 1 : 3),
        0
      );
      return body + String((10 - (sum % 10)) % 10);
    };
    const digits = (n: number) =>
      String(Number.parseInt(run, 16) % 1e8).padStart(8, "0") + String(n);
    const code = barcodeFor(digits(1));
    const bareCode = barcodeFor(digits(2));
    const decoyCode = barcodeFor(digits(3));
    const name = `IT Product ${run}`;
    const bareName = `IT Typed Product ${run}`;
    let slug = "";
    let bareSlug = "";
    let decoySlug = "";

    const remove = (s: string) => () =>
      admin.DELETE("/api/recipes/{slug}", { params: { path: { slug: s } } });

    beforeAll(async () => {
      slug = await createProductRecipe(
        {
          name,
          info: {
            barcode: code,
            servingGrams: 60,
            servingUnit: "g",
            packGrams: 180,
          },
          perServing: { kcal: 218.4, protein: 20.3, carbs: 16.9, fat: 8.9 },
          orgURL: `https://world.openfoodfacts.org/product/${code}`,
          nutrition: "source",
        },
        { client }
      );
      cleanup.push(remove(slug));
      bareSlug = await createProductRecipe(
        {
          name: bareName,
          info: {
            barcode: bareCode,
            servingGrams: 330,
            servingUnit: "ml",
            packGrams: null,
          },
          perServing: { kcal: 140 },
          orgURL: null,
          nutrition: "reviewed",
        },
        { client }
      );
      cleanup.push(remove(bareSlug));

      // The same digits under another extras key: a lookup by value alone
      // would find it, so it must be told apart.
      decoySlug = unwrap(
        await admin.POST("/api/recipes", {
          body: { name: `IT Decoy ${run}` },
        })
      );
      cleanup.push(remove(decoySlug));
      await patchRecipe(
        decoySlug,
        {
          extras: {
            note: decoyCode,
            scrappyProduct: barcodeFor(digits(4)),
          },
        },
        { client }
      );
    });

    it("reads a created product back with per-serving nutrition, product info and import state", async () => {
      const r = (await getRecipe(slug, { client }))!;
      expect(r).toMatchObject({
        name,
        servings: 1,
        sourceUrl: `https://world.openfoodfacts.org/product/${code}`,
        importState: { review: "done", nutrition: "source" },
        product: {
          barcode: code,
          servingGrams: 60,
          servingUnit: "g",
          packGrams: 180,
        },
      });
      expect(r.nutrition.perServing).toEqual({
        kcal: 218.4,
        protein: 20.3,
        carbs: 16.9,
        fat: 8.9,
      });
      expect(r.nutrition).toMatchObject({
        status: "partial",
        missing: ["fibre"],
      });
      expect(r.tags).toContainEqual({ name: "Product", slug: "product" });
      // Mealie's sample ingredient and step must not stay.
      expect(r.ingredients).toEqual([]);
      expect(r.instructions).toEqual([]);
    });

    it("keeps a typed-in product in ml, reviewed, with no source link", async () => {
      const r = (await getRecipe(bareSlug, { client }))!;
      expect(r).toMatchObject({
        sourceUrl: null,
        importState: { review: "done", nutrition: "reviewed" },
        product: { servingGrams: 330, servingUnit: "ml", packGrams: null },
      });
      expect(r.nutrition.perServing).toEqual({ kcal: 140 });
    });

    it("leaves ordinary recipes without product info", async () => {
      expect((await getRecipe(ids.fullSlug, { client }))!.product).toBeNull();
    });

    it("finds a product by barcode", async () => {
      expect(await findProductByBarcode(code, { client })).toEqual({
        slug,
        name,
      });
      expect(await findProductByBarcode(bareCode, { client })).toMatchObject({
        slug: bareSlug,
      });
    });

    it("returns null for an unknown barcode", async () => {
      expect(
        await findProductByBarcode(barcodeFor(digits(9)), { client })
      ).toBeNull();
    });

    it("doesn't return a recipe that has the digits under another extras key", async () => {
      expect(await findProductByBarcode(decoyCode, { client })).toBeNull();
    });

    it("refuses a barcode that isn't digits", async () => {
      await expect(
        findProductByBarcode('1" OR 1=1', { client })
      ).rejects.toBeInstanceOf(Error);
    });

    it("finds products by name, marked as products", async () => {
      const none = { tags: [], categories: [], quick: false };
      const found = await discoverRecipes(
        { ...none, search: name },
        { client }
      );
      expect(found.items.find((r) => r.slug === slug)).toMatchObject({
        isProduct: true,
      });
      const soup = await discoverRecipes(
        { ...none, search: `Lentil Soup ${run}` },
        { client }
      );
      expect(soup.items.find((r) => r.slug === ids.fullSlug)).toMatchObject({
        isProduct: false,
      });
    });

    it("leaves products out of Discover unless the Product tag is chosen", async () => {
      const none = { tags: [], categories: [], quick: false };
      const all = async (filters: Parameters<typeof discoverRecipes>[0]) => {
        const slugs: string[] = [];
        for (let page: number | null = 1; page !== null;) {
          const result = await discoverRecipes(filters, { client, page });
          slugs.push(...result.items.map((r) => r.slug));
          page = result.nextPage;
        }
        return slugs;
      };

      const plain = await all(none);
      expect(plain).toContain(ids.bareSlug);
      expect(plain).not.toContain(slug);
      expect(plain).not.toContain(bareSlug);

      expect(await all({ ...none, tags: ["product"] })).toEqual(
        expect.arrayContaining([slug, bareSlug])
      );
      // A search by name finds them without the tag.
      expect(await all({ ...none, search: name })).toContain(slug);
      // The tag filter combines with the quick filter's query.
      expect(await all({ ...none, quick: true })).not.toContain(slug);
    });
  });

  describe("importing", () => {
    const sourceUrl = `https://example.com/it-${run}/lentil-soup`;
    let slug = "";

    beforeAll(async () => {
      // create/url needs a page Mealie can fetch, and it refuses local
      // addresses; create/html-or-json runs the same scraper on given HTML.
      const page = `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: `IT Imported Soup ${run}`,
        recipeYield: "4 servings",
        recipeIngredient: ["200 g red lentils", "a squeeze of lemon"],
        nutrition: { "@type": "NutritionInformation", calories: "320 kcal" },
      })}</script>`;
      slug = unwrap(
        await admin.POST("/api/recipes/create/html-or-json", {
          body: { data: page, url: sourceUrl },
        })
      );
      cleanup.push(() =>
        admin.DELETE("/api/recipes/{slug}", { params: { path: { slug } } })
      );
    });

    it("returns null when Mealie won't import from a URL", async () => {
      expect(
        await importRecipeFromUrl("http://127.0.0.1:1/recipe", { client })
      ).toBeNull();
    });

    it("finds a recipe by the URL it came from", async () => {
      expect(await findRecipeBySourceUrl(sourceUrl, { client })).toEqual({
        slug,
        name: `IT Imported Soup ${run}`,
      });
      expect(
        await findRecipeBySourceUrl(`${sourceUrl}/other`, { client })
      ).toBeNull();
    });

    it("reads the source URL and treats a fresh import as reviewed", async () => {
      const r = (await getRecipe(slug, { client }))!;
      expect(r.sourceUrl).toBe(sourceUrl);
      expect(r.importState).toEqual({ review: "done", nutrition: null });
      expect(r.ingredients.every((i) => i.food === null)).toBe(true);
    });

    it("parses ingredient lines", async () => {
      const [lentils, lemon] = await parseIngredients(
        ["200 g red lentils", "a squeeze of lemon"],
        { client }
      );
      expect(lentils).toMatchObject({
        input: "200 g red lentils",
        quantity: 200,
        food: { name: "red lentils" },
      });
      expect(lentils.unit?.name).toBeTruthy();
      expect(lentils.confidence).toBeGreaterThan(lemon.confidence);
      expect(lemon.quantity).toBeNull();
      expect(await parseIngredients([], { client })).toEqual([]);
    });

    it("patches the import state without touching other fields", async () => {
      await patchRecipe(
        slug,
        { extras: { scrappyReview: "pending", scrappyNutrition: "source" } },
        { client }
      );
      const r = (await getRecipe(slug, { client }))!;
      expect(r.importState).toEqual({ review: "pending", nutrition: "source" });
      expect(r.sourceUrl).toBe(sourceUrl);
      expect(r.nutrition.perServing.kcal).toBe(320);
      expect(r.ingredients).toHaveLength(2);
    });
  });

  describe("AI settings", () => {
    // In production the planner's token belongs to a plain member, not an
    // admin; the group's AI provider settings endpoint is manage-only.
    let member: MealieClient;
    let memberId = "";

    beforeAll(async () => {
      const group = unwrap(await admin.GET("/api/groups/self"));
      const household = unwrap(await admin.GET("/api/households/self"));
      const email = `it-member-${run}@example.com`;
      const password = `it-member-${run}-Pw`;
      const user = unwrap(
        await admin.POST("/api/admin/users", {
          body: {
            username: `it-member-${run}`,
            fullName: "IT Member",
            email,
            password,
            group: group.name,
            household: household.name,
            admin: false,
            canManage: false,
            canInvite: false,
            canOrganize: false,
          },
        })
      );
      memberId = user.id;
      cleanup.push(() =>
        admin.DELETE("/api/admin/users/{item_id}", {
          params: { path: { item_id: memberId } },
        })
      );
      const login = await fetch(`${baseUrl}/api/auth/token`, {
        method: "POST",
        body: new URLSearchParams({ username: email, password }),
      });
      const { access_token } = (await login.json()) as {
        access_token: string;
      };
      member = createMealieClient({ baseUrl: baseUrl!, token: access_token });
    });

    it("reads them with a member's token", async () => {
      const settings = await getAiSettings({ client: member });
      expect(typeof settings.aiEnabled).toBe("boolean");
      expect(typeof settings.imageProviderEnabled).toBe("boolean");
    });
  });

  describe("foods and units", () => {
    const deleteFood = (id: string) =>
      cleanup.push(() =>
        admin.DELETE("/api/foods/{item_id}", {
          params: { path: { item_id: id } },
        })
      );
    const deleteUnit = (id: string) =>
      cleanup.push(() =>
        admin.DELETE("/api/units/{item_id}", {
          params: { path: { item_id: id } },
        })
      );

    it("creates a food that is missing, then finds it again ignoring case and spaces", async () => {
      const name = `it-quinoa-${run}`;
      const created = await findOrCreateFood(name, { client });
      deleteFood(created.id);
      expect(created).toEqual({ id: expect.any(String), name });

      const again = await findOrCreateFood(`  ${name.toUpperCase()} `, {
        client,
      });
      expect(again.id).toBe(created.id);
      expect(again.name).toBe(name);
    });

    it("finds an existing food by its plural name", async () => {
      const name = `it-tomato-${run}`;
      const food = unwrap(
        await admin.POST("/api/foods", {
          body: { name, pluralName: `${name}es` },
        })
      );
      deleteFood(food.id);

      const found = await findOrCreateFood(`${name}ES`, { client });
      expect(found.id).toBe(food.id);
    });

    it("finds a food that already exists", async () => {
      const found = await findOrCreateFood(`it-lentils-${run}`, { client });
      expect(found.id).toBe(ids.food);
    });

    it("creates a unit that is missing, then finds it again ignoring case and spaces", async () => {
      const name = `it-pinch-${run}`;
      const created = await findOrCreateUnit(name, { client });
      deleteUnit(created.id);
      expect(created).toEqual({ id: expect.any(String), name });

      const again = await findOrCreateUnit(` ${name.toUpperCase()}`, {
        client,
      });
      expect(again.id).toBe(created.id);
    });

    it("finds a unit by its abbreviation", async () => {
      const unit = unwrap(
        await admin.POST("/api/units", {
          body: { name: `it-bushel-${run}`, abbreviation: `itbu${run}` },
        })
      );
      deleteUnit(unit.id);

      const found = await findOrCreateUnit(`ITBU${run}`, { client });
      expect(found.id).toBe(unit.id);
    });

    it("finds a unit by its plural name", async () => {
      const name = `it-sprig-${run}`;
      const unit = unwrap(
        await admin.POST("/api/units", {
          body: { name, pluralName: `${name}s` },
        })
      );
      deleteUnit(unit.id);

      const found = await findOrCreateUnit(`${name}S`, { client });
      expect(found.id).toBe(unit.id);
    });
  });
});

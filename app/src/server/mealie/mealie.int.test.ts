// Runs against a real Mealie. Uses the admin login to create an API token and
// fixtures, exercises our wrapper with that token, then removes everything.
//
//   MEALIE_TEST_URL=http://localhost:9000 pnpm test:integration
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  checkMealieVersion,
  createMealieClient,
  type MealieClient,
  MealieError,
  unwrap,
} from "./client";
import { getRecipe, searchRecipes } from "./recipes";
import {
  addShoppingItems,
  createShoppingList,
  deleteShoppingItems,
  findShoppingListByName,
  getShoppingListItems,
} from "./shopping";

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
            },
          ],
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
      `server ${v.server}, schema ${v.schema}: run pnpm mealie:types`
    ).toBe(true);
  });

  it("rejects a bad token with a MealieError", async () => {
    const bad = createMealieClient({ baseUrl: baseUrl!, token: "nope" });
    const err = await searchRecipes("", { client: bad }).catch((e) => e);
    expect(err).toBeInstanceOf(MealieError);
    expect(err.status).toBe(401);
  });

  it("searches recipes", async () => {
    const page = await searchRecipes(`Lentil Soup ${run}`, { client });
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
    expect(salt).toMatchObject({ quantity: null, food: null, unit: null });
    expect(salt.display).toContain("salt to taste");
  });

  it("flags a recipe without nutrition or servings", async () => {
    const r = (await getRecipe(ids.bareSlug, { client }))!;
    expect(r.nutrition.status).toBe("missing");
    expect(r.servings).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    expect(await getRecipe(`does-not-exist-${run}`, { client })).toBeNull();
  });

  it("creates, fills, finds and empties a shopping list", async () => {
    const name = `IT Week ${run}`;
    const listId = await createShoppingList(name, { client });
    cleanup.push(() =>
      admin.DELETE("/api/households/shopping/lists/{item_id}", {
        params: { path: { item_id: listId } },
      })
    );

    expect(await findShoppingListByName(name, { client })).toEqual(listId);
    expect(
      await findShoppingListByName(`IT Missing ${run}`, { client })
    ).toBeNull();

    const recipe = (await getRecipe(ids.fullSlug, { client }))!;
    const first = await addShoppingItems(
      listId,
      [
        {
          quantity: 450,
          foodId: ids.food,
          unitId: ids.unit,
          recipeIds: [recipe.id],
        },
        { quantity: 1, note: "salt" },
      ],
      { client }
    );
    expect(first.created).toHaveLength(2);
    expect(first.created.find((i) => i.foodId === ids.food)).toMatchObject({
      quantity: 450,
      unitId: ids.unit,
    });

    // Same food + unit again: Mealie merges into the existing line.
    const second = await addShoppingItems(
      listId,
      [{ quantity: 50, foodId: ids.food, unitId: ids.unit }],
      { client }
    );
    const merged = [...second.created, ...second.updated].find(
      (i) => i.foodId === ids.food
    )!;
    expect(merged.quantity).toBe(500);

    const items = await getShoppingListItems(listId, { client });
    expect(items).toHaveLength(2);

    await deleteShoppingItems(
      items.map((i) => i.id),
      { client }
    );
    expect(await getShoppingListItems(listId, { client })).toEqual([]);
  });
});

import { sql } from "drizzle-orm";
// Prepares a known state for the e2e journeys:
// - empties the planner database (DATABASE_URL) and creates two users,
// - creates a recipe with nutrition and parsed ingredients in Mealie (MEALIE_TEST_URL, admin login),
//   and one imported from a web page, for the import and review journey.
// Refuses to run unless E2E_ALLOW_RESET=1, so it can never wipe a real database by accident.
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { createDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { createUser } from "../src/server/users";

export const STATE_FILE = path.join(__dirname, ".state.json");
export const USERS = {
  alex: {
    name: "Alex",
    email: "alex@example.test",
    password: "alex e2e password",
  },
  sam: { name: "Sam", email: "sam@example.test", password: "sam e2e password" },
};

export default async function globalSetup() {
  if (process.env.E2E_ALLOW_RESET !== "1") {
    throw new Error("Set E2E_ALLOW_RESET=1: this empties DATABASE_URL");
  }
  const url = process.env.DATABASE_URL;
  const mealie = process.env.MEALIE_TEST_URL?.replace(/\/$/, "");
  if (!url || !mealie) {
    throw new Error("DATABASE_URL and MEALIE_TEST_URL are required");
  }

  await runMigrations(url, path.join(__dirname, "../drizzle"));
  const { db, pool } = createDb(url, { max: 1 });
  await db.execute(
    sql`TRUNCATE users, day_overrides, meal_slots, slot_portions, adherence, recipe_cache, shopping_ticks, shopping_hidden, shopping_extras, household_settings CASCADE`
  );
  for (const u of Object.values(USERS)) {
    await createUser(db, u);
  }
  await pool.end();

  const login = await fetch(`${mealie}/api/auth/token`, {
    method: "POST",
    body: new URLSearchParams({
      username: process.env.MEALIE_TEST_USER ?? "changeme@example.com",
      password: process.env.MEALIE_TEST_PASSWORD ?? "MyPassword",
    }),
  });
  const { access_token } = await login.json();
  const api = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${mealie}${p}`, {
      method,
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`${method} ${p}: ${res.status} ${await res.text()}`);
    }
    return res.json();
  };

  const run = Date.now().toString(36);
  const food = await api("POST", "/api/foods", { name: `e2e lentils ${run}` });
  const unit = await api("POST", "/api/units", {
    name: `e2e gram ${run}`,
    abbreviation: "g",
  });
  const name = `E2E Lentil Soup ${run}`;
  const slug: string = await api("POST", "/api/recipes", { name });
  const lentilsRef = crypto.randomUUID();
  await api("PATCH", `/api/recipes/${slug}`, {
    recipeServings: 4,
    // The picker starts on the slot's tag: Alex plans it for lunch.
    tags: [{ name: "Lunch" }],
    nutrition: {
      calories: "400",
      proteinContent: "25",
      carbohydrateContent: "50",
      fatContent: "10",
      fiberContent: "12",
    },
    recipeIngredient: [
      {
        quantity: 400,
        food: { id: food.id, name: food.name },
        unit: { id: unit.id, name: unit.name },
        note: "",
        referenceId: lentilsRef,
      },
    ],
    recipeInstructions: [
      { title: "Soup", text: "Rinse the lentils." },
      {
        text: "Simmer for 20 minutes.",
        ingredientReferences: [{ referenceId: lentilsRef }],
      },
    ],
    notes: [{ title: "Freezing", text: "Keeps for 3 months." }],
  });

  // A recipe that already came from a web page, for the import and review
  // journey. Mealie won't fetch a page in CI, so it scrapes given HTML.
  const imported = {
    name: `E2E Imported Soup ${run}`,
    url: `https://example.com/e2e/imported-soup-${run}`,
  };
  const importedSlug: string = await api(
    "POST",
    "/api/recipes/create/html-or-json",
    {
      url: imported.url,
      data: `<html><head><script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: imported.name,
        recipeYield: "4 servings",
        // Only calories, so the other macros are missing on the review page.
        nutrition: { "@type": "NutritionInformation", calories: "350" },
        recipeIngredient: [
          "200 g red lentils",
          "1 onion, chopped",
          "a squeeze of lemon",
        ],
        recipeInstructions: [{ "@type": "HowToStep", text: "Boil." }],
      })}</script></head><body></body></html>`,
    }
  );

  await writeFile(
    STATE_FILE,
    JSON.stringify({
      recipe: { name, slug },
      imported: { ...imported, slug: importedSlug },
      food: food.name,
      extra: `coffee ${run}`,
    })
  );
}

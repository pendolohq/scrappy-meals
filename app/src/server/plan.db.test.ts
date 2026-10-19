import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { MealieUnavailableError } from "./mealie/client";
import type { Recipe } from "./mealie/recipes";
import {
  addMeal,
  getWeekPlan,
  PlanError,
  removeMeal,
  setBaseServings,
  setPortion,
} from "./plan";
import { loadRecipes, type RecipeFetcher } from "./recipe-cache";
import { createUser } from "./users";

const recipe = (slug: string, kcal = 400): Recipe => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug,
  name: `Recipe ${slug}`,
  imagePath: null,
  servings: 4,
  updatedAt: null,
  ingredients: [],
  nutrition: {
    perServing: { kcal, protein: 20, carbs: 40, fat: 15, fibre: 6 },
    missing: [],
    status: "complete",
  },
});

describe.skipIf(!testDbUrl)("plan (Postgres)", () => {
  const db = useTestDb();
  const fetch = vi.fn<RecipeFetcher>(async (slug: string) =>
    slug === "gone" ? null : recipe(slug)
  );
  const pw = "correct horse battery";

  async function twoUsers() {
    const a = await createUser(db, {
      name: "A",
      email: "a@example.test",
      password: pw,
    });
    const b = await createUser(db, {
      name: "B",
      email: "b@example.test",
      password: pw,
    });
    return { a, b };
  }

  it("adds meals with a portion of 1 per member and orders them by position", async () => {
    const { a, b } = await twoUsers();
    const first = await addMeal(
      db,
      { date: "2026-10-20", slot: "snack", slug: "nuts", createdBy: a.id },
      { fetch }
    );
    const second = await addMeal(
      db,
      { date: "2026-10-20", slot: "snack", slug: "apple", createdBy: b.id },
      { fetch }
    );

    const week = await getWeekPlan(db, "2026-10-19", { fetch });
    expect(week.members.map((m) => m.name)).toEqual(["A", "B"]);
    expect(week.days).toHaveLength(7);
    const tuesday = week.days[1];
    expect(tuesday.meals.map((m) => [m.id, m.position, m.slug])).toEqual([
      [first, 0, "nuts"],
      [second, 1, "apple"],
    ]);
    expect(tuesday.meals[0].portions).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(tuesday.meals[0].recipe?.nutrition.perServing.kcal).toBe(400);
    expect(week.days[0].meals).toEqual([]);
  });

  it("refuses a recipe that doesn't exist in Mealie", async () => {
    const { a } = await twoUsers();
    await expect(
      addMeal(
        db,
        { date: "2026-10-20", slot: "lunch", slug: "gone", createdBy: a.id },
        { fetch }
      )
    ).rejects.toBeInstanceOf(PlanError);
  });

  it("only returns the requested week", async () => {
    const { a } = await twoUsers();
    await addMeal(
      db,
      { date: "2026-10-18", slot: "dinner", slug: "x", createdBy: a.id },
      { fetch }
    ); // Sunday before
    await addMeal(
      db,
      { date: "2026-10-26", slot: "dinner", slug: "y", createdBy: a.id },
      { fetch }
    ); // Monday after
    const week = await getWeekPlan(db, "2026-10-19", { fetch });
    expect(week.days.flatMap((d) => d.meals)).toEqual([]);
  });

  it("updates portions and servings, validates ranges, and removes meals", async () => {
    const { a, b } = await twoUsers();
    const id = await addMeal(
      db,
      { date: "2026-10-21", slot: "dinner", slug: "stew", createdBy: a.id },
      { fetch }
    );
    await setPortion(db, id, b.id, 0);
    await setPortion(db, id, a.id, 1.5);
    await setBaseServings(db, id, 2);
    let meal = (await getWeekPlan(db, "2026-10-19", { fetch })).days[2]
      .meals[0];
    expect(meal).toMatchObject({
      baseServings: 2,
      portions: { [a.id]: 1.5, [b.id]: 0 },
    });

    await expect(setPortion(db, id, a.id, -1)).rejects.toThrow(
      "between 0 and 20"
    );
    await expect(setBaseServings(db, id, 0)).rejects.toThrow(
      "between 0 and 100"
    );

    await removeMeal(db, id);
    meal = (await getWeekPlan(db, "2026-10-19", { fetch })).days[2].meals[0];
    expect(meal).toBeUndefined();
  });

  it("caches recipes, refreshes stale ones, and keeps stale copies when Mealie is down", async () => {
    const t0 = new Date("2026-10-19T10:00:00Z");
    const f = vi.fn<RecipeFetcher>(async (slug: string) => recipe(slug, 300));
    await loadRecipes(db, ["soup"], { fetch: f, now: t0 });
    await loadRecipes(db, ["soup"], {
      fetch: f,
      now: new Date(t0.getTime() + 30 * 60_000),
    });
    expect(f).toHaveBeenCalledTimes(1); // fresh enough

    const down = vi.fn<RecipeFetcher>(async () => {
      throw new Error("ECONNREFUSED");
    });
    const later = new Date(t0.getTime() + 2 * 3600_000);
    const stale = await loadRecipes(db, ["soup"], { fetch: down, now: later });
    expect(down).toHaveBeenCalledTimes(1);
    expect(stale.get("soup")?.nutrition.perServing.kcal).toBe(300);

    const deleted = await loadRecipes(db, ["soup"], {
      fetch: async () => null,
      now: later,
    });
    expect(deleted.get("soup")).toBeNull();
  });

  it("says Mealie is down rather than that the recipe doesn't exist", async () => {
    const { a } = await twoUsers();
    const down = async () => {
      throw new MealieUnavailableError("refused");
    };
    await expect(
      addMeal(
        db,
        { date: "2026-10-22", slot: "lunch", slug: "soup", createdBy: a.id },
        { fetch: down }
      )
    ).rejects.toThrow(/isn't reachable/);
  });

  it("shows a planned recipe that disappeared from Mealie as missing", async () => {
    const { a } = await twoUsers();
    await addMeal(
      db,
      { date: "2026-10-22", slot: "lunch", slug: "temp", createdBy: a.id },
      { fetch }
    );
    // The cache is still fresh, so the plan keeps showing it until the next refresh...
    const week = await getWeekPlan(db, "2026-10-19", {
      fetch: async () => null,
    });
    expect(week.days[3].meals[0].recipe?.name).toBe("Recipe temp");
    // ...after which Mealie's 404 removes it.
    await loadRecipes(db, ["temp"], { fetch: async () => null, force: true });
    const after = await getWeekPlan(db, "2026-10-19", {
      fetch: async () => null,
    });
    expect(after.days[3].meals[0]).toMatchObject({
      slug: "temp",
      recipe: null,
    });
  });
});

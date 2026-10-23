import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { mealSlots, recipeCache } from "./db/schema";
import type { ProductInfo } from "./domain/product";
import type { SlotType } from "./domain/slots";
import { setSnackSlots } from "./household";
import { MealieUnavailableError } from "./mealie/client";
import type { Recipe } from "./mealie/recipes";
import {
  addMeal,
  checkNewMeal,
  copyWeek,
  getMeal,
  getWeekPlan,
  hasMeals,
  moveMeal,
  PlanError,
  removeMeal,
  removeMeals,
  setAdherence,
  setBaseServings,
  setFasting,
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
  sourceUrl: null,
  importState: { review: "done", nutrition: null },
  ingredients: [],
  instructions: [],
  notes: [],
  tags: [],
  categories: [],
  totalMinutes: null,
  product: null,
  noShopping: false,
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

  /** Plans a recipe, as Add does. */
  const plan = (
    by: string,
    date: string,
    slot: SlotType,
    slug: string,
    snackIndex = 0
  ) => addMeal(db, { date, slot, snackIndex, slug, createdBy: by }, { fetch });
  /** A week's meals, where each sits and what it is. */
  const placed = async (weekStart: string) =>
    (await getWeekPlan(db, weekStart, { fetch })).days.flatMap((d) =>
      d.meals.map((m) => ({
        date: m.date,
        slot: m.slot,
        snackIndex: m.snackIndex,
        position: m.position,
        slug: m.slug,
      }))
    );

  /** Where a meal is planned now. */
  const at = async (id: string) => {
    const meal = await getMeal(db, id, { fetch });
    return (
      meal && { date: meal.date, slot: meal.slot, snackIndex: meal.snackIndex }
    );
  };

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

  it("tells whether a week has anything planned, Monday to Sunday", async () => {
    const { a } = await twoUsers();
    expect(await hasMeals(db, "2026-10-19")).toBe(false);
    await addMeal(
      db,
      { date: "2026-10-18", slot: "dinner", slug: "x", createdBy: a.id },
      { fetch }
    ); // Sunday before
    expect(await hasMeals(db, "2026-10-19")).toBe(false);
    await addMeal(
      db,
      { date: "2026-10-25", slot: "dinner", slug: "y", createdBy: a.id },
      { fetch }
    ); // Sunday
    expect(await hasMeals(db, "2026-10-19")).toBe(true);
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

  it("with defer, serves stale recipes at once and refreshes them afterwards", async () => {
    const t0 = new Date("2026-10-19T10:00:00Z");
    await loadRecipes(db, ["soup"], {
      fetch: async (slug) => recipe(slug, 300),
      now: t0,
    });

    const f = vi.fn<RecipeFetcher>(async (slug: string) => recipe(slug, 500));
    const deferred: Array<() => Promise<void>> = [];
    const later = new Date(t0.getTime() + 2 * 3600_000);
    const loaded = await loadRecipes(db, ["soup", "new"], {
      fetch: f,
      now: later,
      defer: (work) => deferred.push(work),
    });
    expect(loaded.get("soup")?.nutrition.perServing.kcal).toBe(300);
    expect(loaded.get("new")?.name).toBe("Recipe new"); // not cached: fetched now
    expect(f).toHaveBeenCalledTimes(1);

    await Promise.all(deferred.map((work) => work()));
    const refreshed = await loadRecipes(db, ["soup"], { fetch: f, now: later });
    expect(refreshed.get("soup")?.nutrition.perServing.kcal).toBe(500);
  });

  it("follows a recipe renamed in Mealie (new slug, same id)", async () => {
    const { a } = await twoUsers();
    await addMeal(
      db,
      { date: "2026-10-22", slot: "lunch", slug: "soup", createdBy: a.id },
      { fetch }
    );
    const id = recipe("soup").id;
    const renamed = async (slug: string) =>
      slug === id
        ? { ...recipe("soup"), slug: "soup-2", name: "Soup 2" }
        : null;

    await loadRecipes(db, ["soup"], { fetch: renamed, force: true });
    const week = await getWeekPlan(db, "2026-10-19", { fetch: renamed });
    expect(week.days[3].meals[0]).toMatchObject({
      slug: "soup-2",
      recipe: { name: "Soup 2" },
    });
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

  describe("snack slots", () => {
    it("keeps snacks in different snack slots apart, each at position 0", async () => {
      const { a } = await twoUsers();
      const morning = await addMeal(
        db,
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 0,
          slug: "nuts",
          createdBy: a.id,
        },
        { fetch }
      );
      const afternoon = await addMeal(
        db,
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 1,
          slug: "apple",
          createdBy: a.id,
        },
        { fetch }
      );

      const week = await getWeekPlan(db, "2026-10-19", { fetch });
      expect(week.snackSlots).toBe(2);
      expect(
        week.days[1].meals.map((m) => [m.id, m.snackIndex, m.position])
      ).toEqual(
        expect.arrayContaining([
          [morning, 0, 0],
          [afternoon, 1, 0],
        ])
      );
      expect(week.days[1].meals).toHaveLength(2);
    });

    it("lists a day's meals in eating order, whatever order they were added in", async () => {
      const { a } = await twoUsers();
      const added: [SlotType, number][] = [
        ["dinner", 0],
        ["snack", 1],
        ["lunch", 0],
        ["snack", 0],
        ["breakfast", 0],
      ];
      for (const [slot, snackIndex] of added) {
        await addMeal(
          db,
          {
            date: "2026-10-20",
            slot,
            snackIndex,
            slug: `${slot}-${snackIndex}`,
            createdBy: a.id,
          },
          { fetch }
        );
      }
      const meals = (await getWeekPlan(db, "2026-10-19", { fetch })).days[1]
        .meals;
      expect(meals.map((m) => m.slug)).toEqual([
        "breakfast-0",
        "snack-0",
        "lunch-0",
        "snack-1",
        "dinner-0",
      ]);
    });

    it("numbers positions within one snack slot", async () => {
      const { a } = await twoUsers();
      for (const slug of ["x", "y"]) {
        await addMeal(
          db,
          {
            date: "2026-10-20",
            slot: "snack",
            snackIndex: 1,
            slug,
            createdBy: a.id,
          },
          { fetch }
        );
      }
      const meals = (await getWeekPlan(db, "2026-10-19", { fetch })).days[1]
        .meals;
      expect(meals.map((m) => [m.snackIndex, m.position])).toEqual([
        [1, 0],
        [1, 1],
      ]);
    });

    it("defaults the snack index to 0", async () => {
      const { a } = await twoUsers();
      await addMeal(
        db,
        { date: "2026-10-20", slot: "snack", slug: "nuts", createdBy: a.id },
        { fetch }
      );
      const meals = (await getWeekPlan(db, "2026-10-19", { fetch })).days[1]
        .meals;
      expect(meals.map((m) => m.snackIndex)).toEqual([0]);
    });

    it("refuses a snack slot at or beyond the household's count", async () => {
      const { a } = await twoUsers();
      const add = (snackIndex: number, f: RecipeFetcher = fetch) =>
        addMeal(
          db,
          {
            date: "2026-10-20",
            slot: "snack",
            snackIndex,
            slug: "nuts",
            createdBy: a.id,
          },
          { fetch: f }
        );

      await expect(add(2)).rejects.toBeInstanceOf(PlanError);
      await expect(add(2)).rejects.toThrow(
        "That snack slot is turned off in settings"
      );

      await setSnackSlots(db, 0);
      await expect(add(0)).rejects.toBeInstanceOf(PlanError);

      // Validated before the recipe is fetched.
      const spy = vi.fn<RecipeFetcher>(async (slug) => recipe(slug));
      await expect(add(0, spy)).rejects.toBeInstanceOf(PlanError);
      expect(spy).not.toHaveBeenCalled();

      await setSnackSlots(db, 4);
      await expect(add(3)).resolves.toEqual(expect.any(String));
    });

    it("refuses a snack index on a meal slot", async () => {
      const { a } = await twoUsers();
      const spy = vi.fn<RecipeFetcher>(async (slug) => recipe(slug));
      await expect(
        addMeal(
          db,
          {
            date: "2026-10-20",
            slot: "lunch",
            snackIndex: 1,
            slug: "soup",
            createdBy: a.id,
          },
          { fetch: spy }
        )
      ).rejects.toBeInstanceOf(PlanError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("keeps planned snacks when the count is lowered", async () => {
      const { a, b } = await twoUsers();
      const id = await addMeal(
        db,
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 1,
          slug: "apple",
          createdBy: a.id,
        },
        { fetch }
      );
      await setPortion(db, id, b.id, 0.5);

      await setSnackSlots(db, 0);

      const week = await getWeekPlan(db, "2026-10-19", { fetch });
      expect(week.snackSlots).toBe(0);
      expect(week.days[1].meals).toHaveLength(1);
      expect(week.days[1].meals[0]).toMatchObject({
        id,
        slot: "snack",
        snackIndex: 1,
        portions: { [a.id]: 1, [b.id]: 0.5 },
      });
    });

    it("reads a row inserted without a snack index as snack 0", async () => {
      await db.insert(mealSlots).values({
        date: "2026-10-20",
        slot: "snack",
        mealieRecipeSlug: "legacy",
      });
      const meals = (await getWeekPlan(db, "2026-10-19", { fetch })).days[1]
        .meals;
      expect(meals.map((m) => [m.slug, m.snackIndex])).toEqual([["legacy", 0]]);
    });

    it("returns the snack index from getMeal", async () => {
      const { a } = await twoUsers();
      const id = await addMeal(
        db,
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 1,
          slug: "apple",
          createdBy: a.id,
        },
        { fetch }
      );
      const meal = await getMeal(db, id, { fetch });
      expect(meal).toMatchObject({ slot: "snack", snackIndex: 1 });
    });
  });

  describe("getMeal", () => {
    it("returns one meal with its portions, members and whole recipe", async () => {
      const { a, b } = await twoUsers();
      const withSteps = vi.fn<RecipeFetcher>(async (slug) => ({
        ...recipe(slug),
        instructions: [{ title: null, text: "Simmer." }],
      }));
      const id = await addMeal(
        db,
        { date: "2026-10-22", slot: "dinner", slug: "soup", createdBy: a.id },
        { fetch: withSteps }
      );
      await setPortion(db, id, b.id, 0.5);

      const meal = await getMeal(db, id, { fetch: withSteps });
      expect(meal).toMatchObject({
        id,
        date: "2026-10-22",
        slot: "dinner",
        slug: "soup",
        baseServings: 1,
        portions: { [a.id]: 1, [b.id]: 0.5 },
        recipe: {
          name: "Recipe soup",
          servings: 4,
          instructions: [{ title: null, text: "Simmer." }],
        },
      });
      expect(meal?.members.map((m) => m.name)).toEqual(["A", "B"]);
      expect(withSteps).toHaveBeenCalledTimes(1); // served from the cache
    });

    it("is null for a meal that doesn't exist", async () => {
      expect(
        await getMeal(db, "00000000-0000-4000-8000-0000000000ff", { fetch })
      ).toBeNull();
    });

    it("fetches instructions for a recipe cached before they were kept", async () => {
      const { a } = await twoUsers();
      const id = await addMeal(
        db,
        { date: "2026-10-22", slot: "dinner", slug: "soup", createdBy: a.id },
        { fetch }
      );
      await db
        .update(recipeCache)
        .set({ instructions: null, notes: null })
        .where(eq(recipeCache.slug, "soup"));

      const meal = await getMeal(db, id, {
        fetch: async (slug) => ({
          ...recipe(slug),
          instructions: [{ title: null, text: "Simmer." }],
        }),
      });
      expect(meal?.recipe?.instructions).toEqual([
        { title: null, text: "Simmer." },
      ]);
    });

    it("keeps the cached recipe when Mealie is down", async () => {
      const { a } = await twoUsers();
      const id = await addMeal(
        db,
        { date: "2026-10-22", slot: "dinner", slug: "soup", createdBy: a.id },
        { fetch }
      );
      await db
        .update(recipeCache)
        .set({ instructions: null, fetchedAt: new Date("2020-01-01") })
        .where(eq(recipeCache.slug, "soup"));
      const down = async () => {
        throw new MealieUnavailableError("refused");
      };

      const meal = await getMeal(db, id, { fetch: down });
      expect(meal?.recipe).toMatchObject({
        name: "Recipe soup",
        instructions: null,
      });
      expect(meal?.portions[a.id]).toBe(1);
    });
  });

  describe("copyWeek", () => {
    const lastWeek = "2026-10-12";
    const thisWeek = "2026-10-19";
    it("copies every meal into the same weekday and slot, with portions and servings but no logs", async () => {
      const { a, b } = await twoUsers();
      const monday = await plan(a.id, "2026-10-12", "dinner", "stew");
      await plan(a.id, "2026-10-12", "dinner", "salad");
      await plan(b.id, "2026-10-18", "snack", "nuts", 1);
      await setPortion(db, monday, b.id, 0.5);
      await setBaseServings(db, monday, 2);
      await setAdherence(db, monday, a.id, "stuck");

      const result = await copyWeek(db, lastWeek, thisWeek, b.id);

      expect(result).toMatchObject({ skipped: 0 });
      expect(result.copied).toHaveLength(3);
      expect(await placed(thisWeek)).toEqual([
        {
          date: "2026-10-19",
          slot: "dinner",
          snackIndex: 0,
          position: 0,
          slug: "stew",
        },
        {
          date: "2026-10-19",
          slot: "dinner",
          snackIndex: 0,
          position: 1,
          slug: "salad",
        },
        {
          date: "2026-10-25",
          slot: "snack",
          snackIndex: 1,
          position: 0,
          slug: "nuts",
        },
      ]);
      const [copy] = (await getWeekPlan(db, thisWeek, { fetch })).days[0].meals;
      expect(copy).toMatchObject({
        baseServings: 2,
        portions: { [a.id]: 1, [b.id]: 0.5 },
        adherence: {},
      });
      // Last week is untouched.
      expect(await placed(lastWeek)).toHaveLength(3);
    });

    it("skips slots that already have a meal and counts what it skipped", async () => {
      const { a } = await twoUsers();
      await plan(a.id, "2026-10-12", "lunch", "soup");
      await plan(a.id, "2026-10-12", "lunch", "bread");
      await plan(a.id, "2026-10-12", "dinner", "stew");
      await plan(a.id, "2026-10-19", "lunch", "pizza");

      const result = await copyWeek(db, lastWeek, thisWeek, a.id);

      expect(result).toMatchObject({ skipped: 2 });
      expect(result.copied).toHaveLength(1);
      expect(await placed(thisWeek)).toEqual([
        {
          date: "2026-10-19",
          slot: "lunch",
          snackIndex: 0,
          position: 0,
          slug: "pizza",
        },
        {
          date: "2026-10-19",
          slot: "dinner",
          snackIndex: 0,
          position: 0,
          slug: "stew",
        },
      ]);
    });

    it("never copies twice: a second copy skips everything", async () => {
      const { a } = await twoUsers();
      await plan(a.id, "2026-10-14", "breakfast", "oats");
      await copyWeek(db, lastWeek, thisWeek, a.id);
      expect(await copyWeek(db, lastWeek, thisWeek, a.id)).toEqual({
        copied: [],
        skipped: 1,
      });
      expect(await placed(thisWeek)).toHaveLength(1);
    });

    it("keeps a snack's index past the household's count", async () => {
      const { a } = await twoUsers();
      await setSnackSlots(db, 4);
      await plan(a.id, "2026-10-13", "snack", "dates", 3);
      await setSnackSlots(db, 2);

      await copyWeek(db, lastWeek, thisWeek, a.id);

      expect(await placed(thisWeek)).toEqual([
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 3,
          position: 0,
          slug: "dates",
        },
      ]);
    });

    it("zeroes the portion of anyone fasting on the new day", async () => {
      const { a, b } = await twoUsers();
      await plan(a.id, "2026-10-15", "lunch", "soup");
      await setFasting(db, b.id, "2026-10-22", true);

      await copyWeek(db, lastWeek, thisWeek, a.id);

      const [copy] = (await getWeekPlan(db, thisWeek, { fetch })).days[3].meals;
      expect(copy.portions).toEqual({ [a.id]: 1, [b.id]: 0 });
    });

    it("can be undone by removing the copied meals", async () => {
      const { a } = await twoUsers();
      await plan(a.id, "2026-10-12", "dinner", "stew");
      await plan(a.id, "2026-10-19", "lunch", "pizza");
      const { copied } = await copyWeek(db, lastWeek, thisWeek, a.id);

      await removeMeals(db, copied);

      expect((await placed(thisWeek)).map((m) => m.slug)).toEqual(["pizza"]);
    });
  });

  describe("moveMeal", () => {
    it("moves a meal to another slot on the same day, keeping its portions, servings and logs", async () => {
      const { a, b } = await twoUsers();
      const id = await addMeal(
        db,
        { date: "2026-10-20", slot: "lunch", slug: "soup", createdBy: a.id },
        { fetch }
      );
      await setPortion(db, id, b.id, 2);
      await setBaseServings(db, id, 1.5);
      await setAdherence(db, id, a.id, "swapped", "Toast");

      expect(
        await moveMeal(db, id, { date: "2026-10-20", slot: "dinner" })
      ).toBe("2026-10-20");

      const [meal] = (await getWeekPlan(db, "2026-10-19", { fetch })).days[1]
        .meals;
      expect(meal).toMatchObject({
        id,
        slot: "dinner",
        position: 0,
        baseServings: 1.5,
        portions: { [a.id]: 1, [b.id]: 2 },
        adherence: { [a.id]: { status: "swapped", note: "Toast" } },
      });
    });

    it("moves a meal to another day, and to another week", async () => {
      const { a } = await twoUsers();
      const id = await addMeal(
        db,
        {
          date: "2026-10-20",
          slot: "snack",
          snackIndex: 1,
          slug: "nuts",
          createdBy: a.id,
        },
        { fetch }
      );
      await moveMeal(db, id, {
        date: "2026-10-23",
        slot: "snack",
        snackIndex: 1,
      });
      expect(await at(id)).toEqual({
        date: "2026-10-23",
        slot: "snack",
        snackIndex: 1,
      });

      expect(
        await moveMeal(db, id, { date: "2026-10-27", slot: "breakfast" })
      ).toBe("2026-10-23");
      expect(await at(id)).toEqual({
        date: "2026-10-27",
        slot: "breakfast",
        snackIndex: 0,
      });
      expect(await hasMeals(db, "2026-10-19")).toBe(false);
    });

    it("puts a meal moved into a filled slot after the meals already there", async () => {
      const { a } = await twoUsers();
      const add = (slot: SlotType, slug: string) =>
        addMeal(
          db,
          { date: "2026-10-21", slot, slug, createdBy: a.id },
          { fetch }
        );
      await add("dinner", "stew");
      await add("dinner", "salad");
      const id = await add("lunch", "soup");

      await moveMeal(db, id, { date: "2026-10-21", slot: "dinner" });

      const day = (await getWeekPlan(db, "2026-10-19", { fetch })).days[2];
      expect(day.meals.map((m) => [m.slug, m.slot, m.position])).toEqual([
        ["stew", "dinner", 0],
        ["salad", "dinner", 1],
        ["soup", "dinner", 2],
      ]);
    });

    it("leaves a meal moved onto its own slot where it is", async () => {
      const { a } = await twoUsers();
      const add = () =>
        addMeal(
          db,
          { date: "2026-10-21", slot: "dinner", slug: "stew", createdBy: a.id },
          { fetch }
        );
      const first = await add();
      await add();

      await moveMeal(db, first, { date: "2026-10-21", slot: "dinner" });

      const day = (await getWeekPlan(db, "2026-10-19", { fetch })).days[2];
      expect(day.meals.map((m) => [m.id === first, m.position])).toEqual([
        [true, 0],
        [false, 1],
      ]);
    });

    it("refuses a snack slot turned off in settings, a snack index on a meal slot, and a missing meal", async () => {
      const { a } = await twoUsers();
      const id = await addMeal(
        db,
        { date: "2026-10-20", slot: "lunch", slug: "soup", createdBy: a.id },
        { fetch }
      );
      await expect(
        moveMeal(db, id, { date: "2026-10-20", slot: "snack", snackIndex: 3 })
      ).rejects.toThrow("turned off in settings");
      await expect(
        moveMeal(db, id, { date: "2026-10-20", slot: "dinner", snackIndex: 1 })
      ).rejects.toThrow("Only snacks");
      await removeMeal(db, id);
      await expect(
        moveMeal(db, id, { date: "2026-10-21", slot: "dinner" })
      ).rejects.toThrow("no longer exists");
    });
  });

  describe("products and unplanned meals", () => {
    const info: ProductInfo = {
      barcode: "5000159461122",
      servingGrams: 50,
      servingUnit: "g",
      packGrams: 50,
    };
    const productFetch = vi.fn<RecipeFetcher>(async (slug: string) => ({
      ...recipe(slug),
      product: slug === "bar" ? info : null,
    }));
    const today = "2026-10-20";
    const add = (
      by: string,
      extra: {
        slug?: string;
        date?: string;
        baseServings?: number;
        unplanned?: boolean;
      } = {}
    ) =>
      addMeal(
        db,
        {
          date: extra.date ?? today,
          slot: "snack",
          slug: extra.slug ?? "bar",
          createdBy: by,
          today,
          ...extra,
        },
        { fetch: productFetch }
      );
    const meals = async (date = today) =>
      (
        await getWeekPlan(db, "2026-10-19", { fetch: productFetch })
      ).days.flatMap((d) => d.meals.filter((m) => m.date === date));

    it("gives a product's portion of 1 to whoever added it and 0 to everyone else", async () => {
      const { a, b } = await twoUsers();
      await add(a.id);
      await add(b.id, { slug: "soup" });

      const [bar, soup] = await meals();
      expect(bar.portions).toEqual({ [a.id]: 1, [b.id]: 0 });
      // A recipe is unchanged: everyone gets a portion.
      expect(soup.portions).toEqual({ [a.id]: 1, [b.id]: 1 });
    });

    it("gives a single food to whoever added it, like a product", async () => {
      const { a, b } = await twoUsers();
      const fetch = vi.fn<RecipeFetcher>(async (slug: string) => ({
        ...recipe(slug),
        tags: [{ name: "Food", slug: "food" }],
      }));
      await addMeal(
        db,
        {
          date: today,
          slot: "breakfast",
          slug: "kiwi",
          createdBy: b.id,
          today,
        },
        { fetch }
      );

      const plan = await getWeekPlan(db, "2026-10-19", { fetch });
      const [kiwi] = plan.days.flatMap((d) => d.meals);
      expect(kiwi.portions).toEqual({ [a.id]: 0, [b.id]: 1 });
      expect(kiwi.recipe?.tags).toEqual([{ name: "Food", slug: "food" }]);
    });

    it("gives an unplanned recipe to whoever added it alone", async () => {
      const { a, b } = await twoUsers();
      await add(a.id, { slug: "soup", unplanned: true });
      await add(b.id, { slug: "soup" });

      const [eaten, planned] = await meals();
      expect(eaten.portions).toEqual({ [a.id]: 1, [b.id]: 0 });
      expect(planned.portions).toEqual({ [a.id]: 1, [b.id]: 1 });
    });

    it("gives the adder a portion on their fast only when they already had it", async () => {
      const { a, b } = await twoUsers();
      await setFasting(db, a.id, today, true);
      await setFasting(db, b.id, today, true);

      await add(a.id, { unplanned: true });
      await add(a.id);
      await add(b.id, { slug: "soup" });

      const [eaten, planned, soup] = await meals();
      expect(eaten.portions).toEqual({ [a.id]: 1, [b.id]: 0 });
      expect(planned.portions).toEqual({ [a.id]: 0, [b.id]: 0 });
      expect(soup.portions).toEqual({ [a.id]: 0, [b.id]: 0 });
    });

    it("stores baseServings, defaulting to 1, and refuses values outside 0.01 to 100", async () => {
      const { a } = await twoUsers();
      await add(a.id, { baseServings: 1.5 });
      await add(a.id, { slug: "soup" });
      expect((await meals()).map((m) => m.baseServings)).toEqual([1.5, 1]);

      for (const bad of [0, -1, 0.001, 100.5]) {
        await expect(add(a.id, { baseServings: bad })).rejects.toBeInstanceOf(
          PlanError
        );
      }
      await expect(add(a.id, { baseServings: 0.01 })).resolves.toBeTruthy();
      await expect(add(a.id, { baseServings: 100 })).resolves.toBeTruthy();
    });

    it("stores unplanned for today and earlier, and not for ordinary meals", async () => {
      const { a } = await twoUsers();
      await add(a.id, { unplanned: true });
      await add(a.id, { date: "2026-10-19", unplanned: true });
      await add(a.id, { slug: "soup" });

      expect((await meals()).map((m) => m.unplanned)).toEqual([true, false]);
      expect((await meals("2026-10-19")).map((m) => m.unplanned)).toEqual([
        true,
      ]);
    });

    it("refuses an unplanned meal for a day after the viewer's today, but plans ahead as normal", async () => {
      const { a } = await twoUsers();
      await expect(
        add(a.id, { date: "2026-10-21", unplanned: true })
      ).rejects.toBeInstanceOf(PlanError);
      expect(await meals("2026-10-21")).toEqual([]);

      await add(a.id, { date: "2026-10-21", unplanned: false });
      expect((await meals("2026-10-21"))[0].unplanned).toBe(false);
    });

    it("shows the product on the week's recipe and on the meal page", async () => {
      const { a } = await twoUsers();
      const id = await add(a.id, { unplanned: true });
      await add(a.id, { slug: "soup" });

      const [bar, soup] = await meals();
      expect(bar.recipe?.product).toEqual(info);
      expect(soup.recipe?.product).toBeNull();

      const detail = await getMeal(db, id, { fetch: productFetch });
      expect(detail).toMatchObject({ unplanned: true });
      expect(detail?.recipe?.product).toEqual(info);
    });

    it("keeps the unplanned flag when a meal moves", async () => {
      const { a } = await twoUsers();
      const id = await add(a.id, { unplanned: true });
      await moveMeal(db, id, { date: "2026-10-19", slot: "dinner", today });
      expect((await meals("2026-10-19"))[0]).toMatchObject({
        id,
        unplanned: true,
      });
    });

    it("checks a new meal up front: bad servings, a snack slot that is off, an unplanned meal for a day to come", async () => {
      const ok = { date: today, slot: "snack" as const, today };
      await expect(checkNewMeal(db, ok)).resolves.toBeUndefined();
      await expect(
        checkNewMeal(db, { ...ok, baseServings: 0 })
      ).rejects.toBeInstanceOf(PlanError);
      await expect(
        checkNewMeal(db, { ...ok, snackIndex: 3 })
      ).rejects.toBeInstanceOf(PlanError);
      await expect(
        checkNewMeal(db, { ...ok, date: "2026-10-21", unplanned: true })
      ).rejects.toBeInstanceOf(PlanError);
      await expect(
        checkNewMeal(db, { ...ok, date: "2026-10-21", unplanned: false })
      ).resolves.toBeUndefined();
    });

    it("won't move an unplanned meal to a day after the viewer's today", async () => {
      const { a } = await twoUsers();
      const id = await add(a.id, { unplanned: true });
      const to = { date: "2026-10-21", slot: "snack" as const, today };
      await expect(moveMeal(db, id, to)).rejects.toBeInstanceOf(PlanError);
      await expect(
        moveMeal(db, id, { ...to, today: undefined })
      ).rejects.toBeInstanceOf(PlanError);
      expect(await meals("2026-10-21")).toEqual([]);

      await moveMeal(db, id, { ...to, date: "2026-10-19" });
      expect(await meals("2026-10-19")).toHaveLength(1);

      // A planned meal still moves anywhere.
      const planned = await add(a.id, { slug: "soup" });
      await moveMeal(db, planned, to);
      expect(await meals("2026-10-21")).toHaveLength(1);
    });

    it("keeps an unplanned meal's portions when its day becomes a fast", async () => {
      const { a } = await twoUsers();
      await add(a.id, { unplanned: true });
      await add(a.id, { slug: "soup" });

      expect(await setFasting(db, a.id, today, true)).toBe(1);

      const [bar, soup] = await meals();
      expect(bar.portions[a.id]).toBe(1);
      expect(soup.portions[a.id]).toBe(0);
    });

    it("copies into a slot where only an unplanned meal sits, after it", async () => {
      const { a } = await twoUsers();
      await add(a.id, { slug: "soup", date: "2026-10-13" });
      await add(a.id, { unplanned: true });

      const result = await copyWeek(db, "2026-10-12", "2026-10-19", a.id);

      expect(result).toMatchObject({ skipped: 0 });
      expect(result.copied).toHaveLength(1);
      const day = await meals();
      expect(day.map((m) => [m.slug, m.unplanned])).toEqual([
        ["bar", true],
        ["soup", false],
      ]);
    });

    it("leaves unplanned meals out when copying a week, without counting them as skipped", async () => {
      const { a } = await twoUsers();
      await plan(a.id, "2026-10-13", "dinner", "stew");
      await add(a.id, { date: "2026-10-13", unplanned: true });
      await add(a.id, { date: "2026-10-14", unplanned: true });
      // The unplanned snack's slot is taken in the target week, so copying it would count as skipped.
      await addMeal(
        db,
        { date: "2026-10-20", slot: "snack", slug: "soup", createdBy: a.id },
        { fetch: productFetch }
      );

      const result = await copyWeek(db, "2026-10-12", "2026-10-19", a.id);

      expect(result.copied).toHaveLength(1);
      expect(result.skipped).toBe(0);
      const copied = await meals("2026-10-20");
      expect(copied.map((m) => m.slug).toSorted()).toEqual(["soup", "stew"]);
      expect(copied.every((m) => !m.unplanned)).toBe(true);
    });
  });
});

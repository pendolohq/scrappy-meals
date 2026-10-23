import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { planChanges, users } from "./db/schema";
import { fitPortions } from "./fit-portions";
import type { Recipe } from "./mealie/recipes";
import {
  addMeal,
  getWeekPlan,
  PlanError,
  setAdherence,
  setPortion,
} from "./plan";
import { undoChange } from "./plan-changes";
import type { RecipeFetcher } from "./recipe-cache";
import { createUser } from "./users";

const recipe = (slug: string): Recipe => ({
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
  tags: slug === "kiwi" ? [{ name: "Food", slug: "food" }] : [],
  categories: [],
  totalMinutes: null,
  product: null,
  noShopping: false,
  nutrition: {
    perServing: { kcal: 400, protein: 20, carbs: 40, fat: 15, fibre: 6 },
    missing: [],
    status: "complete",
  },
});

const week = "2026-10-19";
const monday = "2026-10-19";
const tuesday = "2026-10-20";

describe.skipIf(!testDbUrl)("fitPortions (Postgres)", () => {
  const db = useTestDb();
  const fetch = vi.fn<RecipeFetcher>(async (slug: string) => recipe(slug));
  const pw = "correct horse battery";

  const person = async (name: string, kcal: number | null, protein = 0) => {
    const u = await createUser(db, {
      name,
      email: `${name.toLowerCase()}@example.test`,
      password: pw,
    });
    await db
      .update(users)
      .set({ targetKcal: kcal, targetProteinG: kcal ? protein : null })
      .where(eq(users.id, u.id));
    return u;
  };

  const plan = (
    by: string,
    date: string,
    slot: "lunch" | "dinner",
    slug = "stew",
    unplanned = false
  ) =>
    addMeal(
      db,
      { date, slot, slug, createdBy: by, unplanned, today: tuesday },
      { fetch }
    );

  const portionsOf = async (mealId: string) =>
    (await getWeekPlan(db, week, { fetch })).days
      .flatMap((d) => d.meals)
      .find((m) => m.id === mealId)!.portions;

  const fit = (userId: string, dates: string[], today = monday) =>
    fitPortions(db, { weekStart: week, dates, today, userId }, { fetch });

  it("fits a day to each person's targets as one change, and undo puts it back", async () => {
    const a = await person("A", 1200, 60);
    const b = await person("B", 800, 40);
    const lunch = await plan(a.id, monday, "lunch");
    const dinner = await plan(a.id, monday, "dinner");

    const result = await fit(a.id, [monday]);

    // A eats 3 servings across the day, B 2: 1200 and 800 kcal.
    const [l, d] = [await portionsOf(lunch), await portionsOf(dinner)];
    expect(l[a.id] + d[a.id]).toBe(3);
    expect(l[b.id] + d[b.id]).toBe(2);
    // B's two portions already make 800 kcal, so only A's move.
    expect(result.changed).toBeGreaterThan(0);
    expect(result.averages.map((x) => [x.name, x.macros.kcal])).toEqual([
      ["A", 1200],
      ["B", 800],
    ]);
    expect(result.changeId).toEqual(expect.any(String));
    expect(result.days).toEqual([
      {
        date: monday,
        people: [
          {
            userId: a.id,
            name: "A",
            status: "fitted",
            misses: [],
            incomplete: false,
            estimated: false,
          },
          {
            userId: b.id,
            name: "B",
            status: "fitted",
            misses: [],
            incomplete: false,
            estimated: false,
          },
        ],
      },
    ]);
    const [change] = await db.select().from(planChanges);
    expect(change).toMatchObject({
      kind: "fit",
      userId: a.id,
      summary: "Fitted portions on Mon 19 Oct",
    });

    await undoChange(db, result.changeId!);
    expect(await portionsOf(lunch)).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(await portionsOf(dinner)).toEqual({ [a.id]: 1, [b.id]: 1 });
  });

  it("fits the rest of the week from today, averaging each person's days", async () => {
    const a = await person("A", 1200, 60);
    const past = await plan(a.id, monday, "dinner");
    await plan(a.id, tuesday, "lunch");
    await plan(a.id, tuesday, "dinner");

    const result = await fit(a.id, [monday, tuesday, "2026-10-21"], tuesday);

    expect(await portionsOf(past)).toEqual({ [a.id]: 1 });
    expect(result.days.map((d) => d.date)).toEqual([tuesday, "2026-10-21"]);
    expect(result.days[1].people[0].status).toBe("empty");
    expect(result.averages).toEqual([
      {
        userId: a.id,
        name: "A",
        macros: { kcal: 1200, protein: 60, carbs: 120, fat: 45, fibre: 18 },
        days: 1,
      },
    ]);
    const [change] = await db.select().from(planChanges);
    expect(change.summary).toBe("Fitted portions from Tue 20 Oct");
  });

  it("leaves off-plan, logged and single-food portions alone, but counts them", async () => {
    const a = await person("A", 1600, 80);
    const offPlan = await plan(a.id, monday, "lunch", "stew", true);
    const kiwi = await plan(a.id, monday, "lunch", "kiwi");
    const dinner = await plan(a.id, monday, "dinner");
    const logged = await plan(a.id, monday, "dinner");
    await setAdherence(db, logged, a.id, "stuck");

    await fit(a.id, [monday]);

    expect(await portionsOf(offPlan)).toEqual({ [a.id]: 1 });
    expect(await portionsOf(kiwi)).toEqual({ [a.id]: 1 });
    expect(await portionsOf(logged)).toEqual({ [a.id]: 1 });
    // 1200 kcal already eaten or fixed: dinner makes up the last 400.
    expect(await portionsOf(dinner)).toEqual({ [a.id]: 1 });
  });

  it("records nothing when the portions already fit", async () => {
    const a = await person("A", 800, 40);
    await plan(a.id, monday, "lunch");
    await plan(a.id, monday, "dinner");

    const result = await fit(a.id, [monday]);

    expect(result).toMatchObject({ changeId: null, changed: 0 });
    expect(await db.select().from(planChanges)).toEqual([]);
  });

  it("keeps the portions of someone without targets", async () => {
    const a = await person("A", null);
    const meal = await plan(a.id, monday, "dinner");
    await setPortion(db, meal, a.id, 1.75);

    const result = await fit(a.id, [monday]);

    expect(await portionsOf(meal)).toEqual({ [a.id]: 1.75 });
    expect(result.days[0].people[0].status).toBe("no-targets");
  });

  it("refuses days that have passed and days outside the week", async () => {
    const a = await person("A", 1200, 60);
    await expect(fit(a.id, [monday], tuesday)).rejects.toThrow(
      new PlanError("Those days have passed: there's nothing left to fit")
    );
    await expect(fit(a.id, ["2026-10-26"])).rejects.toThrow(
      new PlanError("That day isn't in this week")
    );
  });
});

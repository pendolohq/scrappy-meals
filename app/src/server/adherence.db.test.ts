import { describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import type { Recipe } from "./mealie/recipes";
import { addMeal, getWeekPlan, removeMeal, setAdherence } from "./plan";
import { createUser } from "./users";

const fetch = async (slug: string): Promise<Recipe> => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug,
  name: slug,
  imagePath: null,
  servings: 2,
  ingredients: [],
  nutrition: {
    perServing: {},
    missing: ["kcal", "protein", "carbs", "fat", "fibre"],
    status: "missing",
  },
});

describe.skipIf(!testDbUrl)("adherence (Postgres)", () => {
  const db = useTestDb();

  async function setup() {
    const pw = "correct horse battery";
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
    const meal = await addMeal(
      db,
      { date: "2026-10-20", slot: "lunch", slug: "soup", createdBy: a.id },
      { fetch }
    );
    return { a, b, meal };
  }
  const logs = async () =>
    (await getWeekPlan(db, "2026-10-19", { fetch })).days[1].meals[0].adherence;

  it("logs, changes and clears a status per person", async () => {
    const { a, b, meal } = await setup();
    await setAdherence(db, meal, a.id, "stuck");
    await setAdherence(db, meal, b.id, "partial", "  half  ");
    expect(await logs()).toEqual({
      [a.id]: { status: "stuck", note: null },
      [b.id]: { status: "partial", note: "half" },
    });

    await setAdherence(db, meal, a.id, "skipped");
    await setAdherence(db, meal, b.id, null);
    expect(await logs()).toEqual({ [a.id]: { status: "skipped", note: null } });
  });

  it("requires a note for swapped and caps its length", async () => {
    const { a, meal } = await setup();
    await expect(
      setAdherence(db, meal, a.id, "swapped", "   ")
    ).rejects.toThrow("instead");
    await setAdherence(db, meal, a.id, "swapped", "x".repeat(600));
    expect((await logs())[a.id].note).toHaveLength(500);
  });

  it("goes away with the meal", async () => {
    const { a, meal } = await setup();
    await setAdherence(db, meal, a.id, "stuck");
    await removeMeal(db, meal);
    expect(
      (await getWeekPlan(db, "2026-10-19", { fetch })).days[1].meals
    ).toEqual([]);
  });
});

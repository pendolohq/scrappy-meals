import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { dayOverrides } from "./db/schema";
import type { Recipe } from "./mealie/recipes";
import { addMeal, getWeekPlan, setFasting, setPortion } from "./plan";
import { createUser, updateProfile } from "./users";

const fetch = async (slug: string): Promise<Recipe> => ({
  id: "00000000-0000-4000-8000-000000000001",
  slug,
  name: slug,
  imagePath: null,
  servings: 2,
  updatedAt: null,
  ingredients: [],
  nutrition: {
    perServing: { kcal: 500 },
    missing: ["protein", "carbs", "fat", "fibre"],
    status: "partial",
  },
});

const WED = "2026-10-21";
const THU = "2026-10-22";

describe.skipIf(!testDbUrl)("fasting (Postgres)", () => {
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
    // A fasts on Wednesdays by default.
    await updateProfile(db, a.id, {
      name: "A",
      targetKcal: 2000,
      targetProteinG: null,
      targetCarbsG: null,
      targetFatG: null,
      targetFibreG: null,
      defaultFastingDays: [3],
    });
    return { a, b };
  }

  it("gives a fasting person 0 on new meals and everyone else 1", async () => {
    const { a, b } = await setup();
    await addMeal(
      db,
      { date: WED, slot: "lunch", slug: "soup", createdBy: b.id },
      { fetch }
    );
    await addMeal(
      db,
      { date: THU, slot: "lunch", slug: "soup", createdBy: b.id },
      { fetch }
    );
    const week = await getWeekPlan(db, "2026-10-19", { fetch });
    expect(week.days[2].meals[0].portions).toEqual({ [a.id]: 0, [b.id]: 1 });
    expect(week.days[3].meals[0].portions).toEqual({ [a.id]: 1, [b.id]: 1 });
    expect(week.days[2].fasting).toEqual({ [a.id]: true, [b.id]: false });
    expect(week.days[3].fasting).toEqual({ [a.id]: false, [b.id]: false });
  });

  it("starting a fast zeroes that day's portions only", async () => {
    const { a, b } = await setup();
    const thuLunch = await addMeal(
      db,
      { date: THU, slot: "lunch", slug: "soup", createdBy: b.id },
      { fetch }
    );
    await addMeal(
      db,
      { date: THU, slot: "snack", slug: "nuts", createdBy: b.id },
      { fetch }
    );
    const fri = await addMeal(
      db,
      { date: "2026-10-23", slot: "lunch", slug: "soup", createdBy: b.id },
      { fetch }
    );
    await setPortion(db, thuLunch, a.id, 0); // already 0: not counted

    expect(await setFasting(db, a.id, THU, true)).toBe(1);
    const week = await getWeekPlan(db, "2026-10-19", { fetch });
    expect(week.days[3].fasting[a.id]).toBe(true);
    expect(week.days[3].meals.map((m) => m.portions[a.id])).toEqual([0, 0]);
    expect(week.days[3].meals.map((m) => m.portions[b.id])).toEqual([1, 1]);
    expect(week.days[4].meals.find((m) => m.id === fri)?.portions[a.id]).toBe(
      1
    );
  });

  it("ending a fast keeps portions at 0 and new meals count again", async () => {
    const { a, b } = await setup();
    await addMeal(
      db,
      { date: WED, slot: "lunch", slug: "soup", createdBy: b.id },
      { fetch }
    );
    expect(await setFasting(db, a.id, WED, false)).toBe(0);
    expect(
      (await getWeekPlan(db, "2026-10-19", { fetch })).days[2].fasting[a.id]
    ).toBe(false);

    await addMeal(
      db,
      { date: WED, slot: "dinner", slug: "stew", createdBy: b.id },
      { fetch }
    );
    const wed = (await getWeekPlan(db, "2026-10-19", { fetch })).days[2];
    expect(wed.meals.map((m) => [m.slot, m.portions[a.id]])).toEqual([
      ["lunch", 0],
      ["dinner", 1],
    ]);
  });

  it("stores an override only when it differs from the default", async () => {
    const { a } = await setup();
    await setFasting(db, a.id, WED, false);
    await setFasting(db, a.id, THU, true);
    let rows = await db
      .select()
      .from(dayOverrides)
      .where(eq(dayOverrides.userId, a.id));
    expect(rows.map((r) => [r.date, r.isFasting]).sort()).toEqual([
      [WED, false],
      [THU, true],
    ]);

    // Back to the defaults: rows are removed, so later changes to default days apply again.
    await setFasting(db, a.id, WED, true);
    await setFasting(db, a.id, THU, false);
    rows = await db
      .select()
      .from(dayOverrides)
      .where(eq(dayOverrides.userId, a.id));
    expect(rows).toEqual([]);
  });
});

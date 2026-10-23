import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { mealSlots, planChanges, slotPortions } from "./db/schema";
import type { Recipe } from "./mealie/recipes";
import {
  addMeal,
  copyWeek,
  getMeal,
  getWeekPlan,
  PlanError,
  removeMeal,
  setPortion,
} from "./plan";
import {
  latestChange,
  recordChange,
  undoChange,
  type PlanChangeSnapshot,
} from "./plan-changes";
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
  tags: [],
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

const lastWeek = "2026-10-12";
const thisWeek = "2026-10-19";
const nextWeek = "2026-10-26";
const none: PlanChangeSnapshot = { added: [], removed: [], portions: [] };

describe.skipIf(!testDbUrl)("plan change log (Postgres)", () => {
  const db = useTestDb();
  const fetch = vi.fn<RecipeFetcher>(async (slug: string) => recipe(slug));
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

  const plan = (by: string, date: string, slug: string) =>
    addMeal(db, { date, slot: "dinner", slug, createdBy: by }, { fetch });

  const slugsOf = async (weekStart: string) =>
    (await getWeekPlan(db, weekStart, { fetch })).days.flatMap((d) =>
      d.meals.map((m) => m.slug)
    );

  const portionRows = (ids: string[]) =>
    db.select().from(slotPortions).where(inArray(slotPortions.mealSlotId, ids));

  /** Records a change that only adds the given meals, as a draft would. */
  const recordAdded = (
    weekStart: string,
    userId: string | null,
    added: string[],
    summary = "Added meals"
  ) =>
    db.transaction((tx) =>
      recordChange(tx, {
        weekStart,
        userId,
        kind: "draft",
        summary,
        before: { ...none, added },
      })
    );

  const changeRows = () => db.select().from(planChanges);

  it("records a copy change with the summary and the user, and none when nothing was copied", async () => {
    const { a, b } = await twoUsers();
    await plan(a.id, "2026-10-12", "stew");
    await plan(a.id, "2026-10-13", "soup");
    await plan(a.id, "2026-10-14", "rice");

    const result = await copyWeek(db, lastWeek, thisWeek, b.id);

    expect(result.changeId).toEqual(expect.any(String));
    expect(await changeRows()).toMatchObject([
      {
        id: result.changeId,
        weekStart: thisWeek,
        userId: b.id,
        kind: "copy",
        summary: "Copied 3 meals from last week",
        before: { added: result.copied, removed: [], portions: [] },
        undoneAt: null,
      },
    ]);

    const again = await copyWeek(db, lastWeek, thisWeek, b.id);
    expect(again.changeId).toBeNull();
    expect(await changeRows()).toHaveLength(1);
  });

  it("says 1 meal, not 1 meals", async () => {
    const { a } = await twoUsers();
    await plan(a.id, "2026-10-12", "stew");

    await copyWeek(db, lastWeek, thisWeek, a.id);

    expect((await changeRows())[0].summary).toBe(
      "Copied 1 meal from last week"
    );
  });

  it("undoes a copy: the copied meals and their portions go, and it is marked undone once", async () => {
    const { a } = await twoUsers();
    await plan(a.id, "2026-10-12", "stew");
    // Tuesday: a meal already in the week that the undo must leave alone.
    await plan(a.id, "2026-10-20", "pizza");
    const { copied, changeId } = await copyWeek(db, lastWeek, thisWeek, a.id);

    const undone = await undoChange(db, changeId!);

    expect(undone).toEqual({
      weekStart: thisWeek,
      summary: "Copied 1 meal from last week",
    });
    expect(await slugsOf(thisWeek)).toEqual(["pizza"]);
    expect(await portionRows(copied)).toEqual([]);
    expect((await changeRows())[0].undoneAt).toBeInstanceOf(Date);
    await expect(undoChange(db, changeId!)).rejects.toThrow(
      new PlanError("That change was already undone")
    );
  });

  it("skips a copied meal that was deleted by hand since, without an error", async () => {
    const { a } = await twoUsers();
    await plan(a.id, "2026-10-12", "stew");
    await plan(a.id, "2026-10-13", "soup");
    await plan(a.id, "2026-10-14", "rice");
    const { copied, changeId } = await copyWeek(db, lastWeek, thisWeek, a.id);
    await removeMeal(db, copied[1]);

    await undoChange(db, changeId!);

    expect(await slugsOf(thisWeek)).toEqual([]);
  });

  it("restores overwritten portions, skipping a meal deleted since", async () => {
    const { a, b } = await twoUsers();
    const kept = await plan(a.id, "2026-10-20", "stew");
    const gone = await plan(a.id, "2026-10-21", "soup");
    await setPortion(db, kept, b.id, 0.5);
    await setPortion(db, gone, a.id, 2);
    // What a fit does: write new portions and log the old ones in one transaction.
    const id = await db.transaction(async (tx) => {
      await tx
        .update(slotPortions)
        .set({ multiplier: 3 })
        .where(inArray(slotPortions.mealSlotId, [kept, gone]));
      return recordChange(tx, {
        weekStart: thisWeek,
        userId: a.id,
        kind: "fit",
        summary: "Fitted portions",
        before: {
          ...none,
          portions: [
            { mealSlotId: kept, userId: a.id, multiplier: 1 },
            { mealSlotId: kept, userId: b.id, multiplier: 0.5 },
            { mealSlotId: gone, userId: a.id, multiplier: 2 },
          ],
        },
      });
    });
    await removeMeal(db, gone);

    await undoChange(db, id);

    expect((await getMeal(db, kept, { fetch }))?.portions).toEqual({
      [a.id]: 1,
      [b.id]: 0.5,
    });
    expect(await getMeal(db, gone, { fetch })).toBeNull();
  });

  it("puts removed meals back with their id and portions, after one that took their place, and without duplicating one that exists", async () => {
    const { a, b } = await twoUsers();
    const original = {
      date: "2026-10-20",
      slot: "dinner" as const,
      snackIndex: 0,
      position: 0,
      slug: "stew",
      baseServings: 2,
      unplanned: false,
      createdBy: a.id,
    };
    const blocked = { id: crypto.randomUUID(), ...original };
    const free = {
      id: crypto.randomUUID(),
      ...original,
      date: "2026-10-22",
      slug: "soup",
    };
    const present = await plan(a.id, "2026-10-23", "rice");
    // `blocked` and `free` were removed; `present` is in the snapshot but never left.
    const id = await db.transaction((tx) =>
      recordChange(tx, {
        weekStart: thisWeek,
        userId: a.id,
        kind: "draft",
        summary: "Replaced meals",
        before: {
          ...none,
          removed: [
            {
              meal: blocked,
              portions: [
                { userId: a.id, multiplier: 1.5 },
                { userId: b.id, multiplier: 0 },
              ],
            },
            { meal: free, portions: [{ userId: a.id, multiplier: 1 }] },
            {
              meal: {
                ...original,
                id: present,
                date: "2026-10-23",
                slug: "rice",
              },
              portions: [{ userId: a.id, multiplier: 9 }],
            },
          ],
        },
      })
    );
    // Something else now sits where `blocked` was.
    await plan(a.id, "2026-10-20", "salad");

    await undoChange(db, id);

    const [restored] = await db
      .select()
      .from(mealSlots)
      .where(eq(mealSlots.id, blocked.id));
    expect(restored).toMatchObject({
      date: "2026-10-20",
      mealieRecipeSlug: "stew",
      baseServings: 2,
      createdBy: a.id,
      position: 1,
    });
    expect(
      (await portionRows([blocked.id])).map((p) => [p.userId, p.multiplier])
    ).toEqual(
      expect.arrayContaining([
        [a.id, 1.5],
        [b.id, 0],
      ])
    );
    expect(await getMeal(db, free.id, { fetch })).toMatchObject({
      date: "2026-10-22",
      slug: "soup",
    });
    expect(await slugsOf(thisWeek)).toHaveLength(4);
    expect((await getMeal(db, present, { fetch }))?.portions[a.id]).toBe(1);
  });

  it("undoes a week's changes latest first, and other weeks don't interfere", async () => {
    const { a } = await twoUsers();
    const first = await recordAdded(thisWeek, a.id, []);
    const second = await recordAdded(thisWeek, a.id, []);
    const elsewhere = await recordAdded(nextWeek, a.id, []);

    await expect(undoChange(db, first)).rejects.toThrow(
      new PlanError("Undo the later change first")
    );
    // The other week's newer change doesn't block this week's.
    await undoChange(db, second);
    await undoChange(db, first);
    expect((await changeRows()).filter((c) => c.undoneAt)).toHaveLength(2);
    expect(await latestChange(db, nextWeek)).toMatchObject({ id: elsewhere });
  });

  it("keeps two changes recorded in one transaction in order", async () => {
    const { a } = await twoUsers();
    const change = (summary: string) => ({
      weekStart: thisWeek,
      userId: a.id,
      kind: "chat" as const,
      summary,
      before: none,
    });
    const [first, second] = await db.transaction(async (tx) => [
      await recordChange(tx, change("first")),
      await recordChange(tx, change("second")),
    ]);

    expect(await latestChange(db, thisWeek)).toMatchObject({ id: second });
    await expect(undoChange(db, first)).rejects.toThrow(
      new PlanError("Undo the later change first")
    );
  });

  it("lets only one of two undos of the same change through", async () => {
    const { a } = await twoUsers();
    const id = await recordAdded(thisWeek, a.id, []);

    const results = await Promise.allSettled([
      undoChange(db, id),
      undoChange(db, id),
    ]);

    expect(results.map((r) => r.status).toSorted()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });

  it("finds a week's latest change that isn't undone, honouring since and naming who made it", async () => {
    const { a } = await twoUsers();
    expect(await latestChange(db, thisWeek)).toBeNull();
    const first = await recordAdded(thisWeek, a.id, [], "First");
    const second = await recordAdded(thisWeek, a.id, [], "Second");
    await recordAdded(nextWeek, a.id, [], "Other week");

    expect(await latestChange(db, thisWeek)).toEqual({
      id: second,
      kind: "draft",
      summary: "Second",
      createdAt: expect.any(Date),
      byName: "A",
    });
    await undoChange(db, second);
    expect(await latestChange(db, thisWeek)).toMatchObject({ id: first });
    expect(
      await latestChange(db, thisWeek, {
        since: new Date(Date.now() + 60_000),
      })
    ).toBeNull();
    expect(
      await latestChange(db, thisWeek, {
        since: new Date(Date.now() - 60_000),
      })
    ).toMatchObject({ id: first });
    await undoChange(db, first);
    expect(await latestChange(db, thisWeek)).toBeNull();
  });

  it("has no name for a change whose user is gone", async () => {
    await twoUsers();
    await recordAdded(thisWeek, null, []);

    expect(await latestChange(db, thisWeek)).toMatchObject({ byName: null });
  });

  it("prunes changes older than 30 days when recording a new one", async () => {
    const { a } = await twoUsers();
    const old = await recordAdded(thisWeek, a.id, [], "Old");
    const recent = await recordAdded(thisWeek, a.id, [], "Recent");
    await db
      .update(planChanges)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000) })
      .where(eq(planChanges.id, old));
    await db
      .update(planChanges)
      .set({ createdAt: new Date(Date.now() - 29 * 24 * 3600 * 1000) })
      .where(eq(planChanges.id, recent));

    const fresh = await recordAdded(nextWeek, a.id, [], "Fresh");

    expect((await changeRows()).map((c) => c.id).toSorted()).toEqual(
      [recent, fresh].toSorted()
    );
  });

  it("refuses an unknown change", async () => {
    await expect(undoChange(db, crypto.randomUUID())).rejects.toThrow(
      new PlanError("That change can't be undone any more")
    );
  });
});

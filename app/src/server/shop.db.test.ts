import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { UserFacingError } from "./errors";
import type { Ingredient, Recipe } from "./mealie/recipes";
import { addMeal } from "./plan";
import type { RecipeFetcher } from "./recipe-cache";
import {
  addShopExtra,
  checkShopExtra,
  checkShopLine,
  hideShopLine,
  removeShopExtra,
  weekShopList,
} from "./shop";
import { createUser } from "./users";

const WEEK = "2026-10-19";
const OTHER_WEEK = "2026-10-26";
const g = {
  id: "u-g",
  name: "gram",
  abbreviation: "g",
  standardQuantity: 1,
  standardUnit: "gram",
};
const lentils = { id: "f-lentils", name: "lentils", label: "Grains" };
const salt = { id: "f-salt", name: "salt", label: "Spices" };
const ing = (over: Partial<Ingredient>): Ingredient => ({
  quantity: null,
  food: null,
  unit: null,
  note: "",
  display: "",
  ...over,
});

// Servings of 1 and one eater at base servings 1: the recipe is bought as written.
const soup: Recipe = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "soup",
  name: "Lentil soup",
  imagePath: null,
  servings: 1,
  sourceUrl: null,
  importState: { review: "done", nutrition: null },
  ingredients: [
    ing({ quantity: 400, food: lentils, unit: g }),
    ing({ food: salt, display: "salt to taste" }),
    ing({ display: "a handful of parsley" }),
  ],
  instructions: [],
  notes: [],
  tags: [],
  categories: [],
  totalMinutes: null,
  nutrition: { perServing: {}, missing: [], status: "missing" },
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe.skipIf(!testDbUrl)("shop list (Postgres)", () => {
  const db = useTestDb();
  const fetch = vi.fn<RecipeFetcher>(async () => soup);

  async function alex() {
    return createUser(db, {
      name: "Alex",
      email: "alex@example.test",
      password: "correct horse battery",
    });
  }

  /** Alex plans the soup on the Tuesday of WEEK. */
  async function planned() {
    const user = await alex();
    await addMeal(
      db,
      { date: "2026-10-20", slot: "dinner", slug: "soup", createdBy: user.id },
      { fetch }
    );
    return user;
  }

  const list = async (week = WEEK) =>
    (await weekShopList(db, week, { fetch })).items;
  const line = async (id: string, week = WEEK) =>
    (await list(week)).find((i) => i.id === id);
  const count = async (
    table: "shopping_ticks" | "shopping_hidden" | "shopping_extras"
  ) => {
    const res = await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)}`
    );
    return (res.rows[0] as { n: number }).n;
  };
  const parsley = `${soup.id}|a handful of parsley`;

  it("merges the plan's lines, free text and nothing else for an unticked week", async () => {
    await planned();
    const { plan, items } = await weekShopList(db, WEEK, { fetch });
    expect(plan.lines.map((l) => l.key)).toEqual(["f-lentils", "f-salt"]);
    expect(items.map((i) => [i.id, i.source, i.checked])).toEqual([
      ["f-lentils", "plan", false],
      ["f-salt", "plan", false],
      [parsley, "plan", false],
    ]);
    expect(items[0]).toMatchObject({ text: "lentils", amount: "400 g" });
  });

  it("is empty for a week with nothing planned", async () => {
    await planned();
    const { plan, items } = await weekShopList(db, OTHER_WEEK, { fetch });
    expect(plan.lines).toEqual([]);
    expect(items).toEqual([]);
  });

  it("ticks a line, replays the tick, and unticks it", async () => {
    const user = await planned();
    const tick = {
      weekStart: WEEK,
      userId: user.id,
      lineKey: "f-lentils",
      checked: true,
      amounts: [{ quantity: 400, unit: "g" }],
    };
    await checkShopLine(db, tick);
    await checkShopLine(db, tick);
    expect(await count("shopping_ticks")).toBe(1);
    expect((await line("f-lentils"))?.checked).toBe(true);

    await checkShopLine(db, { ...tick, checked: false, amounts: [] });
    expect(await count("shopping_ticks")).toBe(0);
    expect((await line("f-lentils"))?.checked).toBe(false);
  });

  it("ticking again overwrites the snapshot with the new amounts", async () => {
    const user = await planned();
    const base = {
      weekStart: WEEK,
      userId: user.id,
      lineKey: "f-lentils",
      checked: true,
    };
    await checkShopLine(db, {
      ...base,
      amounts: [{ quantity: 100, unit: "g" }],
    });
    expect(await line("f-lentils")).toMatchObject({
      checked: false,
      amount: "300 g more",
    });
    await checkShopLine(db, {
      ...base,
      amounts: [{ quantity: 400, unit: "g" }],
    });
    expect(await count("shopping_ticks")).toBe(1);
    expect((await line("f-lentils"))?.checked).toBe(true);
  });

  it("unticks a key that was never ticked without error", async () => {
    const user = await planned();
    await expect(
      checkShopLine(db, {
        weekStart: WEEK,
        userId: user.id,
        lineKey: "nothing",
        checked: false,
        amounts: [],
      })
    ).resolves.toBeUndefined();
    expect(await count("shopping_ticks")).toBe(0);
  });

  it("shows a line the plan outgrew after the tick as unticked, and a vanished one not at all", async () => {
    const user = await planned();
    await checkShopLine(db, {
      weekStart: WEEK,
      userId: user.id,
      lineKey: "f-lentils",
      checked: true,
      amounts: [{ quantity: 250, unit: "g" }],
    });
    expect(await line("f-lentils")).toMatchObject({
      checked: false,
      amount: "150 g more",
      detail: "400 g in all",
    });

    // Another week has no such line, so the tick row there is kept but unseen.
    await checkShopLine(db, {
      weekStart: OTHER_WEEK,
      userId: user.id,
      lineKey: "f-lentils",
      checked: true,
      amounts: [{ quantity: 250, unit: "g" }],
    });
    expect(await list(OTHER_WEEK)).toEqual([]);
    expect(await count("shopping_ticks")).toBe(2);
  });

  it("keeps ticks per week", async () => {
    const user = await planned();
    await checkShopLine(db, {
      weekStart: OTHER_WEEK,
      userId: user.id,
      lineKey: "f-salt",
      checked: true,
      amounts: [],
    });
    expect((await line("f-salt"))?.checked).toBe(false);
  });

  it("hides a line for the week, also when hidden twice or no longer on the plan", async () => {
    const user = await planned();
    const hide = { weekStart: WEEK, userId: user.id, lineKey: "f-salt" };
    await hideShopLine(db, hide);
    await hideShopLine(db, hide);
    await hideShopLine(db, { ...hide, lineKey: "gone" });
    expect(await count("shopping_hidden")).toBe(2);
    expect((await list()).map((i) => i.id)).toEqual(["f-lentils", parsley]);
  });

  it("adds an extra after the plan's lines, and a replayed add with the same id changes nothing", async () => {
    const user = await planned();
    const extra = {
      weekStart: WEEK,
      userId: user.id,
      id: uuid(1),
      text: "coffee",
    };
    await addShopExtra(db, extra);
    await addShopExtra(db, extra);
    await addShopExtra(db, { ...extra, id: uuid(2), text: "tea" });
    expect(await count("shopping_extras")).toBe(2);
    const items = await list();
    expect(items.slice(-2)).toMatchObject([
      { id: uuid(1), source: "extra", text: "coffee", checked: false },
      { id: uuid(2), source: "extra", text: "tea", checked: false },
    ]);
  });

  it("refuses to add an extra with an id that belongs to another week", async () => {
    const user = await alex();
    await addShopExtra(db, {
      weekStart: WEEK,
      userId: user.id,
      id: uuid(1),
      text: "coffee",
    });
    await expect(
      addShopExtra(db, {
        weekStart: OTHER_WEEK,
        userId: user.id,
        id: uuid(1),
        text: "tea",
      })
    ).rejects.toBeInstanceOf(UserFacingError);
    expect(await list(OTHER_WEEK)).toEqual([]);
    expect((await list(WEEK)).map((i) => i.text)).toEqual(["coffee"]);
  });

  it("ticks and unticks an extra, and a replayed tick changes nothing", async () => {
    const user = await alex();
    await addShopExtra(db, {
      weekStart: WEEK,
      userId: user.id,
      id: uuid(1),
      text: "coffee",
    });
    await checkShopExtra(db, { weekStart: WEEK, id: uuid(1), checked: true });
    await checkShopExtra(db, { weekStart: WEEK, id: uuid(1), checked: true });
    expect((await line(uuid(1)))?.checked).toBe(true);
    await checkShopExtra(db, { weekStart: WEEK, id: uuid(1), checked: false });
    expect((await line(uuid(1)))?.checked).toBe(false);
  });

  it("won't tick an extra that is gone or on another week's list", async () => {
    const user = await alex();
    await addShopExtra(db, {
      weekStart: WEEK,
      userId: user.id,
      id: uuid(1),
      text: "coffee",
    });
    await expect(
      checkShopExtra(db, { weekStart: OTHER_WEEK, id: uuid(1), checked: true })
    ).rejects.toThrow("That item is no longer on the list.");
    await expect(
      checkShopExtra(db, { weekStart: WEEK, id: uuid(9), checked: true })
    ).rejects.toBeInstanceOf(UserFacingError);
    expect((await line(uuid(1)))?.checked).toBe(false);
  });

  it("removes an extra only from its own week, and removing a gone one succeeds", async () => {
    const user = await alex();
    await addShopExtra(db, {
      weekStart: WEEK,
      userId: user.id,
      id: uuid(1),
      text: "coffee",
    });
    await removeShopExtra(db, { weekStart: OTHER_WEEK, id: uuid(1) });
    expect(await count("shopping_extras")).toBe(1);

    await removeShopExtra(db, { weekStart: WEEK, id: uuid(1) });
    await removeShopExtra(db, { weekStart: WEEK, id: uuid(1) });
    await removeShopExtra(db, { weekStart: WEEK, id: uuid(9) });
    expect(await count("shopping_extras")).toBe(0);
  });

  it("works from the cached recipes when Mealie is down", async () => {
    await planned();
    const down = vi.fn<RecipeFetcher>(async () => {
      throw new Error("Mealie is down");
    });
    const { items } = await weekShopList(db, WEEK, { fetch: down });
    expect(items.map((i) => i.id)).toContain("f-lentils");
  });
});

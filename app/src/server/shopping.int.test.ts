// Needs both a live Mealie and a throwaway Postgres:
//   MEALIE_TEST_URL=... DATABASE_TEST_URL=... bun run test:integration
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";

import { addDays, weekStartOf } from "./domain/week";
import { UserFacingError } from "./errors";
import { createMealieClient, type MealieClient, unwrap } from "./mealie/client";
import { getRecipe } from "./mealie/recipes";
import {
  addShoppingItems,
  createShoppingList,
  getShoppingListItems,
} from "./mealie/shopping";
import { addMeal, setPortion } from "./plan";
import {
  addShopItem,
  checkShopItem,
  removeShopItem,
  weekShopList,
} from "./shop";
import {
  pushShoppingList,
  shoppingListName,
  weekShoppingList,
} from "./shopping";
import { createUser } from "./users";

const baseUrl = process.env.MEALIE_TEST_URL;
const run = randomUUID().slice(0, 8);
// Each test gets its own far-future week, so its Mealie list name is unique: the
// push falls back to finding the week's list by name, and a same-named list left
// by another run would otherwise be picked up.
const uniqueWeek = () =>
  weekStartOf(`${2100 + Math.floor(Math.random() * 800)}-06-15`);

describe.skipIf(!baseUrl || !testDbUrl)(
  "shopping push (Mealie + Postgres)",
  () => {
    const db = useTestDb();
    let admin: MealieClient;
    const cleanup: Array<() => Promise<unknown>> = [];
    const ids = { lentils: "", gram: "", slug: "" };
    const fromMealie = (slug: string) => getRecipe(slug, { client: admin });

    beforeAll(async () => {
      const form = new URLSearchParams({
        username: process.env.MEALIE_TEST_USER ?? "changeme@example.com",
        password: process.env.MEALIE_TEST_PASSWORD ?? "MyPassword",
      });
      const login = await fetch(`${baseUrl}/api/auth/token`, {
        method: "POST",
        body: form,
      });
      const { access_token } = (await login.json()) as { access_token: string };
      admin = createMealieClient({ baseUrl: baseUrl!, token: access_token });

      const lentils = unwrap(
        await admin.POST("/api/foods", { body: { name: `it-lentils-${run}` } })
      );
      const gram = unwrap(
        await admin.POST("/api/units", {
          body: { name: `it-gram-${run}`, abbreviation: "g" },
        })
      );
      ids.lentils = lentils.id;
      ids.gram = gram.id;
      ids.slug = unwrap(
        await admin.POST("/api/recipes", {
          body: { name: `IT Shopping Soup ${run}` },
        })
      );
      unwrap(
        await admin.PATCH("/api/recipes/{slug}", {
          params: { path: { slug: ids.slug } },
          body: {
            recipeServings: 4,
            recipeIngredient: [
              {
                quantity: 400,
                food: { id: lentils.id, name: lentils.name },
                unit: { id: gram.id, name: gram.name },
                note: "",
              },
              {
                quantity: 0,
                note: "a handful of parsley",
                originalText: "a handful of parsley",
              },
            ],
          },
        })
      );
      cleanup.push(() =>
        admin.DELETE("/api/recipes/{slug}", {
          params: { path: { slug: ids.slug } },
        })
      );
      cleanup.push(() =>
        admin.DELETE("/api/foods/{item_id}", {
          params: { path: { item_id: lentils.id } },
        })
      );
      cleanup.push(() =>
        admin.DELETE("/api/units/{item_id}", {
          params: { path: { item_id: gram.id } },
        })
      );
    });

    afterAll(async () => {
      for (const fn of cleanup.reverse()) {
        await fn().catch(() => undefined);
      }
    });

    it("pushes the scaled, merged list, then replaces it on re-push", async () => {
      const WEEK = uniqueWeek();
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
      const opts = { client: admin };
      const lunch = await addMeal(
        db,
        {
          date: addDays(WEEK, 1),
          slot: "lunch",
          slug: ids.slug,
          createdBy: a.id,
        },
        { fetch: fromMealie }
      );
      await setPortion(db, lunch, b.id, 0.5); // 1 + 0.5 = 1.5 of 4 servings

      const preview = await weekShoppingList(db, WEEK, opts);
      expect(preview.lines.map((l) => [l.foodId, l.unit, l.quantity])).toEqual([
        [ids.lentils, "g", 150],
      ]);
      expect(preview.freeText.map((f) => f.text)).toEqual([
        "a handful of parsley",
      ]);

      const first = await pushShoppingList(db, WEEK, opts);
      cleanup.push(() =>
        admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: first.listId } },
        })
      );
      expect(first).toMatchObject({
        listName: shoppingListName(WEEK),
        added: 2,
        replaced: 0,
      });

      let items = await getShoppingListItems(first.listId, opts);
      expect(items.find((i) => i.foodId === ids.lentils)).toMatchObject({
        quantity: 150,
        unitId: ids.gram,
      });
      expect(items.find((i) => !i.foodId)?.note).toContain(
        "a handful of parsley"
      );

      // Something added by hand in Mealie survives a re-push.
      const manual = await addShoppingItems(
        first.listId,
        [{ quantity: 1, note: `it-manual-${run}` }],
        opts
      );

      await setPortion(db, lunch, b.id, 1); // now 2 of 4 servings
      const second = await pushShoppingList(db, WEEK, opts);
      expect(second).toMatchObject({
        listId: first.listId,
        added: 2,
        replaced: 2,
      });
      items = await getShoppingListItems(first.listId, opts);
      expect(items).toHaveLength(3);
      expect(items.find((i) => i.foodId === ids.lentils)?.quantity).toBe(200);
      expect(items.some((i) => i.id === manual.created[0].id)).toBe(true);
    });

    it("starts a new list if the old one was deleted in Mealie", async () => {
      const WEEK = uniqueWeek();
      const a = await createUser(db, {
        name: "A",
        email: "a@example.test",
        password: "correct horse battery",
      });
      await addMeal(
        db,
        {
          date: addDays(WEEK, 2),
          slot: "dinner",
          slug: ids.slug,
          createdBy: a.id,
        },
        { fetch: fromMealie }
      );
      const first = await pushShoppingList(db, WEEK, { client: admin });
      unwrap(
        await admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: first.listId } },
        })
      );

      const second = await pushShoppingList(db, WEEK, { client: admin });
      cleanup.push(() =>
        admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: second.listId } },
        })
      );
      expect(second.listId).not.toBe(first.listId);
      expect(second.added).toBe(2);
    });

    it("reports lines Mealie merged into ones added by hand", async () => {
      const WEEK = uniqueWeek();
      const opts = { client: admin };
      const a = await createUser(db, {
        name: "A",
        email: "a@example.test",
        password: "correct horse battery",
      });
      await addMeal(
        db,
        { date: WEEK, slot: "dinner", slug: ids.slug, createdBy: a.id },
        { fetch: fromMealie }
      );
      // Someone already put lentils on the week's list in Mealie.
      const listId = await createShoppingList(shoppingListName(WEEK), opts);
      cleanup.push(() =>
        admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: listId } },
        })
      );
      await addShoppingItems(
        listId,
        [{ quantity: 100, foodId: ids.lentils, unitId: ids.gram }],
        opts
      );

      const pushed = await pushShoppingList(db, WEEK, opts);
      expect(pushed).toMatchObject({ listId, added: 1, merged: 1 });
      const items = await getShoppingListItems(listId, opts);
      expect(items.find((i) => i.foodId === ids.lentils)?.quantity).toBe(200);
    });

    it("ticks, adds and removes items on the week's list, and only there", async () => {
      const WEEK = uniqueWeek();
      const OTHER = addDays(WEEK, 7);
      const opts = { client: admin };
      const a = await createUser(db, {
        name: "A",
        email: "a@example.test",
        password: "correct horse battery",
      });
      for (const week of [WEEK, OTHER]) {
        await addMeal(
          db,
          {
            date: addDays(week, 1),
            slot: "lunch",
            slug: ids.slug,
            createdBy: a.id,
          },
          { fetch: fromMealie }
        );
      }
      const pushed = await pushShoppingList(db, WEEK, opts);
      const other = await pushShoppingList(db, OTHER, opts);
      for (const listId of [pushed.listId, other.listId]) {
        cleanup.push(() =>
          admin.DELETE("/api/households/shopping/lists/{item_id}", {
            params: { path: { item_id: listId } },
          })
        );
      }

      const list = (await weekShopList(db, WEEK, opts))!;
      expect(list).toMatchObject({
        listId: pushed.listId,
        listName: shoppingListName(WEEK),
      });
      const lentils = list.items.find((i) => i.foodId === ids.lentils)!;

      // Ticking keeps everything else about the item, recipe link included.
      await checkShopItem(db, WEEK, lentils.id, true, opts);
      await checkShopItem(db, WEEK, lentils.id, true, opts); // replayed: no-op
      const raw = unwrap(
        await admin.GET("/api/households/shopping/items/{item_id}", {
          params: { path: { item_id: lentils.id } },
        })
      );
      expect(raw).toMatchObject({
        checked: true,
        quantity: lentils.quantity,
        unitId: ids.gram,
        foodId: ids.lentils,
      });
      expect(raw.recipeReferences).toHaveLength(1);
      await checkShopItem(db, WEEK, lentils.id, false, opts);
      expect(
        (await weekShopList(db, WEEK, opts))!.items.find(
          (i) => i.id === lentils.id
        )?.checked
      ).toBe(false);

      // A hand-added line is a plain note, and survives sending the week again.
      const coffee = await addShopItem(db, WEEK, `it-coffee-${run}`, opts);
      expect(coffee).toMatchObject({ listId: pushed.listId, checked: false });
      await pushShoppingList(db, WEEK, opts);
      const after = (await weekShopList(db, WEEK, opts))!.items;
      expect(after.find((i) => i.id === coffee.id)?.note).toBe(
        `it-coffee-${run}`
      );

      // Items on another week's list are out of reach.
      const foreign = (await weekShopList(db, OTHER, opts))!.items[0];
      await expect(
        checkShopItem(db, WEEK, foreign.id, true, opts)
      ).rejects.toThrow(UserFacingError);
      await expect(removeShopItem(db, WEEK, foreign.id, opts)).rejects.toThrow(
        UserFacingError
      );

      await removeShopItem(db, WEEK, coffee.id, opts);
      expect(
        (await weekShopList(db, WEEK, opts))!.items.some(
          (i) => i.id === coffee.id
        )
      ).toBe(false);
      // Removing it again (a replay whose answer was lost) is harmless.
      await removeShopItem(db, WEEK, coffee.id, opts);
      await expect(
        checkShopItem(db, WEEK, coffee.id, true, opts)
      ).rejects.toThrow("no longer on the list");
    });

    it("has no shop list before the week is sent", async () => {
      expect(
        await weekShopList(db, uniqueWeek(), { client: admin })
      ).toBeNull();
    });
  }
);

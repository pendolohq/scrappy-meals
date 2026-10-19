// Needs both a live Mealie and a throwaway Postgres:
//   MEALIE_TEST_URL=... DATABASE_TEST_URL=... pnpm test:integration
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testDbUrl, useTestDb } from "../../test/db";
import { createMealieClient, type MealieClient, unwrap } from "./mealie/client";
import { getRecipe } from "./mealie/recipes";
import { addShoppingItems, getShoppingListItems } from "./mealie/shopping";
import { addMeal, setPortion } from "./plan";
import {
  pushShoppingList,
  shoppingListName,
  weekShoppingList,
} from "./shopping";
import { createUser } from "./users";

const baseUrl = process.env.MEALIE_TEST_URL;
const run = randomUUID().slice(0, 8);
const WEEK = "2026-10-19";

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
        await admin.POST("/api/foods", { body: { name: `it-lentils-${run}` } }),
      );
      const gram = unwrap(
        await admin.POST("/api/units", {
          body: { name: `it-gram-${run}`, abbreviation: "g" },
        }),
      );
      ids.lentils = lentils.id;
      ids.gram = gram.id;
      ids.slug = unwrap(
        await admin.POST("/api/recipes", {
          body: { name: `IT Shopping Soup ${run}` },
        }),
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
        }),
      );
      cleanup.push(() =>
        admin.DELETE("/api/recipes/{slug}", {
          params: { path: { slug: ids.slug } },
        }),
      );
      cleanup.push(() =>
        admin.DELETE("/api/foods/{item_id}", {
          params: { path: { item_id: lentils.id } },
        }),
      );
      cleanup.push(() =>
        admin.DELETE("/api/units/{item_id}", {
          params: { path: { item_id: gram.id } },
        }),
      );
    });

    afterAll(async () => {
      for (const fn of cleanup.reverse()) await fn().catch(() => undefined);
    });

    it("pushes the scaled, merged list, then replaces it on re-push", async () => {
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
        { date: "2026-10-20", slot: "lunch", slug: ids.slug, createdBy: a.id },
        { fetch: fromMealie },
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
        }),
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
        "a handful of parsley",
      );

      // Something added by hand in Mealie survives a re-push.
      const manual = await addShoppingItems(
        first.listId,
        [{ quantity: 1, note: `it-manual-${run}` }],
        opts,
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
      const a = await createUser(db, {
        name: "A",
        email: "a@example.test",
        password: "correct horse battery",
      });
      await addMeal(
        db,
        { date: "2026-10-21", slot: "dinner", slug: ids.slug, createdBy: a.id },
        { fetch: fromMealie },
      );
      const first = await pushShoppingList(db, WEEK, { client: admin });
      unwrap(
        await admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: first.listId } },
        }),
      );

      const second = await pushShoppingList(db, WEEK, { client: admin });
      cleanup.push(() =>
        admin.DELETE("/api/households/shopping/lists/{item_id}", {
          params: { path: { item_id: second.listId } },
        }),
      );
      expect(second.listId).not.toBe(first.listId);
      expect(second.added).toBe(2);
    });
  },
);

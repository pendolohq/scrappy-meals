// Runs against a real Postgres: DATABASE_TEST_URL=postgres://... bun run test:db
import { describe, expect, it, vi } from "vitest";

import { testDbUrl, useTestDb } from "../../../test/db";
import { usdaFoodMatches } from "../db/schema";
import { parseFoodDetails } from "../domain/usda";
import { createUser } from "../users";

import foodsJson from "./fixtures/foods.json";
import {
  ensureFoods,
  listMatches,
  listSuggestMisses,
  saveMatch,
  saveSuggestion,
  saveSuggestMisses,
} from "./foods";

const fixtures = parseFoodDetails(foodsJson);
const KIWI = 168153;
const GARLIC = 169230;
const EGG = 748967;

const FOOD_A = "00000000-0000-4000-8000-00000000000a";
const FOOD_B = "00000000-0000-4000-8000-00000000000b";

/** A client whose `foods` answers from the fixtures and counts what it was asked. */
function fakeClient() {
  const foods = vi.fn<(ids: number[]) => Promise<typeof fixtures>>(
    async (ids) => fixtures.filter((f) => ids.includes(f.fdcId))
  );
  return { foods, search: vi.fn<() => Promise<never[]>>(async () => []) };
}

describe.skipIf(!testDbUrl)("USDA foods and matches (Postgres)", () => {
  const db = useTestDb();
  const newUser = () =>
    createUser(db, {
      name: "Alex",
      email: "alex@example.com",
      password: "hunter2-secret",
    });

  describe("ensureFoods", () => {
    it("fetches the foods and returns them by id", async () => {
      const client = fakeClient();

      const found = await ensureFoods(db, client, [KIWI, GARLIC]);

      expect([...found.keys()].sort()).toEqual([GARLIC, KIWI].sort());
      expect(found.get(GARLIC)).toEqual(
        fixtures.find((f) => f.fdcId === GARLIC)
      );
    });

    it("asks FDC only for the ids it hasn't cached", async () => {
      const client = fakeClient();
      await ensureFoods(db, client, [KIWI]);
      client.foods.mockClear();

      const found = await ensureFoods(db, client, [KIWI, EGG]);

      expect(client.foods).toHaveBeenCalledTimes(1);
      expect(client.foods).toHaveBeenCalledWith([EGG]);
      expect([...found.keys()].sort()).toEqual([EGG, KIWI].sort());
    });

    it("doesn't call FDC when everything is cached", async () => {
      const client = fakeClient();
      await ensureFoods(db, client, [KIWI, GARLIC]);
      client.foods.mockClear();

      const found = await ensureFoods(db, client, [GARLIC, KIWI]);

      expect(client.foods).not.toHaveBeenCalled();
      expect(found.size).toBe(2);
    });

    it("returns the cached portions and macros unchanged", async () => {
      const client = fakeClient();
      await ensureFoods(db, client, [EGG]);
      client.foods.mockClear();

      const found = await ensureFoods(db, client, [EGG]);

      expect(found.get(EGG)).toEqual(fixtures.find((f) => f.fdcId === EGG));
    });
  });

  describe("saveMatch and listMatches", () => {
    const base = {
      mealieFoodId: FOOD_A,
      foodName: "Kiwi",
      fdcId: KIWI,
      status: "suggested" as const,
      pieceGrams: null,
      pieceLabel: null,
      unitGrams: {},
      defaultGrams: null,
    };

    it("saves a match and lists it with its USDA food, ready to use in any recipe", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI]);

      await saveMatch(db, base, user.id);

      const matches = await listMatches(db);
      expect(matches.get(FOOD_A)).toMatchObject({
        fdcId: KIWI,
        status: "suggested",
        pieceGrams: null,
        pieceLabel: null,
        foodName: "Kiwi",
        food: fixtures.find((f) => f.fdcId === KIWI),
      });
    });

    it("keeps the weight of a unit, and none until one is given", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [GARLIC]);
      await saveMatch(db, { ...base, fdcId: GARLIC }, user.id);
      expect((await listMatches(db)).get(FOOD_A)?.unitGrams).toEqual({});

      await saveMatch(
        db,
        { ...base, fdcId: GARLIC, unitGrams: { clove: 4, bulb: 40 } },
        user.id
      );

      expect((await listMatches(db)).get(FOOD_A)?.unitGrams).toEqual({
        clove: 4,
        bulb: 40,
      });
    });

    it("keeps the amount to count when a line gives none", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI]);

      await saveMatch(db, { ...base, defaultGrams: 10 }, user.id);

      expect((await listMatches(db)).get(FOOD_A)?.defaultGrams).toBe(10);
    });

    it("keeps the piece weight and what it was picked from", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI]);

      await saveMatch(
        db,
        { ...base, status: "confirmed", pieceGrams: 69, pieceLabel: "1 fruit" },
        user.id
      );

      expect((await listMatches(db)).get(FOOD_A)).toMatchObject({
        status: "confirmed",
        pieceGrams: 69,
        pieceLabel: "1 fruit",
      });
    });

    it("replaces the match for a food when saved again", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI, GARLIC]);
      await saveMatch(db, base, user.id);

      await saveMatch(
        db,
        {
          ...base,
          fdcId: GARLIC,
          foodName: "Kiwi (renamed)",
          status: "confirmed",
        },
        user.id
      );

      const matches = await listMatches(db);
      expect(matches.size).toBe(1);
      expect(matches.get(FOOD_A)).toMatchObject({
        fdcId: GARLIC,
        status: "confirmed",
        foodName: "Kiwi (renamed)",
      });
    });

    it("keeps a match for each Mealie food", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI, EGG]);

      await saveMatch(db, base, user.id);
      await saveMatch(
        db,
        {
          ...base,
          mealieFoodId: FOOD_B,
          foodName: "Eggs",
          fdcId: EGG,
          status: "confirmed",
        },
        user.id
      );

      const matches = await listMatches(db);
      expect([...matches.keys()].sort()).toEqual([FOOD_A, FOOD_B]);
      expect(matches.get(FOOD_B)?.fdcId).toBe(EGG);
    });

    it("moves updated_at forward when a match is replaced", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI]);
      await saveMatch(db, base, user.id);
      const past = new Date("2020-01-01T00:00:00Z");
      await db
        .update(usdaFoodMatches)
        .set({ createdAt: past, updatedAt: past });

      await saveMatch(db, { ...base, status: "confirmed" }, user.id);

      const [after] = await db.select().from(usdaFoodMatches);
      expect(after!.updatedAt.getTime()).toBeGreaterThan(past.getTime());
      expect(after!.createdAt).toEqual(past);
    });

    it("lists nothing before anything is matched", async () => {
      expect((await listMatches(db)).size).toBe(0);
    });

    it("refuses a match for a food that isn't cached", async () => {
      const user = await newUser();

      await expect(saveMatch(db, base, user.id)).rejects.toThrow(
        /fdc|cache|foreign|violat/i
      );
      expect((await listMatches(db)).size).toBe(0);
    });
  });

  describe("saveSuggestion", () => {
    const suggestion = { mealieFoodId: FOOD_A, foodName: "Kiwi", fdcId: KIWI };

    it("saves a suggestion for a food with no match", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI]);

      expect(await saveSuggestion(db, suggestion, user.id)).toBe(true);

      expect((await listMatches(db)).get(FOOD_A)).toMatchObject({
        fdcId: KIWI,
        status: "suggested",
        pieceGrams: null,
      });
    });

    it("never replaces a match someone confirmed meanwhile", async () => {
      const user = await newUser();
      await ensureFoods(db, fakeClient(), [KIWI, GARLIC]);
      await saveMatch(
        db,
        {
          mealieFoodId: FOOD_A,
          foodName: "Kiwi",
          fdcId: GARLIC,
          status: "confirmed",
          pieceGrams: 5,
          pieceLabel: "1 clove",
          unitGrams: { clove: 4 },
          defaultGrams: null,
        },
        user.id
      );

      expect(await saveSuggestion(db, suggestion, user.id)).toBe(false);

      expect((await listMatches(db)).get(FOOD_A)).toMatchObject({
        fdcId: GARLIC,
        status: "confirmed",
        pieceGrams: 5,
        pieceLabel: "1 clove",
        unitGrams: { clove: 4 },
      });
    });
  });

  describe("suggest misses", () => {
    it("remembers the foods tried, once each", async () => {
      await saveSuggestMisses(db, [FOOD_A]);
      await saveSuggestMisses(db, [FOOD_A, FOOD_B]);
      await saveSuggestMisses(db, []);

      expect([...(await listSuggestMisses(db))].toSorted()).toEqual([
        FOOD_A,
        FOOD_B,
      ]);
    });
  });
});

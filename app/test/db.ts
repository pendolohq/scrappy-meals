import { sql } from "drizzle-orm";
// Shared setup for *.db.test.ts: one migrated throwaway database, emptied per test.
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";

import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";

export const testDbUrl = process.env.DATABASE_TEST_URL;

export function useTestDb() {
  const { db, pool } = createDb(testDbUrl ?? "postgres://unused");
  beforeAll(async () => {
    await runMigrations(testDbUrl!, path.join(__dirname, "../drizzle"));
  });
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE users, day_overrides, meal_slots, slot_portions, adherence, recipe_cache, shopping_ticks, shopping_hidden, shopping_extras, household_settings CASCADE`
    );
  });
  afterAll(async () => {
    await pool.end();
  });
  return db;
}

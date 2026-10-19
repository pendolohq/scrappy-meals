import "server-only";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./client";

export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const { db, pool } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

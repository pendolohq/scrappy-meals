import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(url: string, opts: { max?: number } = {}) {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 5 });
  return { db: drizzle({ client: pool, schema }), pool };
}

// One pool per process; reused across Next.js hot reloads in dev.
const globalForDb = globalThis as unknown as { __db?: ReturnType<typeof createDb> };

export function getDb(): Db {
  if (!globalForDb.__db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL must be set");
    globalForDb.__db = createDb(url);
  }
  return globalForDb.__db.db;
}

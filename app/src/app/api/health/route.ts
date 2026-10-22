import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { checkMealieVersion } from "@/server/mealie/client";

export const dynamic = "force-dynamic";

// Docker's healthcheck gives up after 5 s; a slow Mealie must not use that up.
const MEALIE_TIMEOUT_MS = 2000;

let warnedVersion = false;

async function mealieStatus() {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), MEALIE_TIMEOUT_MS)
  );
  try {
    const v = await Promise.race([checkMealieVersion(), timeout]);
    if (!v.matches && !warnedVersion) {
      warnedVersion = true;
      console.warn(
        `Mealie ${v.server} differs from schema ${v.schema}; regenerate with bun run mealie:types`
      );
    }
    return { reachable: true, versionMatches: v.matches };
  } catch {
    return { reachable: false, versionMatches: false };
  }
}

async function check() {
  const [db, mealie] = await Promise.all([
    getDb()
      .execute(sql`select 1`)
      .then(() => true)
      .catch(() => false),
    mealieStatus(),
  ]);
  return { db, mealie };
}

// Anyone can call this, so hits within a few seconds share one check rather
// than each costing a database query and a call to Mealie.
const FRESH_MS = 5000;
let last: { at: number; result: ReturnType<typeof check> } | null = null;

// Public (used by the container healthcheck), so it reports only booleans.
export async function GET() {
  const now = Date.now();
  if (!last || now - last.at >= FRESH_MS) {
    last = { at: now, result: check() };
  }
  const { db, mealie } = await last.result;

  // Only the database decides liveness; the plan is still readable while Mealie is down.
  return Response.json({ ok: db, db, mealie }, { status: db ? 200 : 503 });
}

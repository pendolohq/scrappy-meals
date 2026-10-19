import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { checkMealieVersion } from "@/server/mealie/client";

export const dynamic = "force-dynamic";

// Public (used by the container healthcheck), so it reports only booleans.
export async function GET() {
  const db = await getDb()
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false);
  const mealie = await checkMealieVersion()
    .then((v) => {
      if (!v.matches) {
        console.warn(
          `Mealie ${v.server} differs from schema ${v.schema}; run pnpm mealie:types`
        );
      }
      return { reachable: true, versionMatches: v.matches };
    })
    .catch(() => ({ reachable: false, versionMatches: false }));

  // Only the database decides liveness; the plan is still readable while Mealie is down.
  return Response.json({ ok: db, db, mealie }, { status: db ? 200 : 503 });
}

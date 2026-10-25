import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  sql,
} from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import {
  adherence,
  mealSlots,
  planChanges,
  slotPortions,
  users,
} from "./db/schema";
import type { PlanChangeSnapshot } from "./domain/plan-change";
import { addDays } from "./domain/week";
import { PlanError } from "./errors";

export type { PlanChangeSnapshot };

type PlanChangeKind = typeof planChanges.$inferInsert.kind;

/** How long a change can be undone; older entries are dropped. */
const UNDO_HOURS = 24;

const undoCutoff = () => new Date(Date.now() - UNDO_HOURS * 3600 * 1000);

/**
 * Makes changes to one week, and their undos, wait for each other until the
 * transaction ends. Without it, a change made while an undo runs could read
 * portions the undo is about to restore, and the order undo relies on would
 * be the order transactions started, not the order they wrote. Take it first
 * in every transaction that records a change.
 */
export async function lockWeek(
  tx: Pick<Db, "execute">,
  weekStart: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`plan-week:${weekStart}`}))`
  );
}

/**
 * Logs a change to a week so it can be undone. Call it in the transaction the
 * change itself runs in, so the two succeed or fail together. Also drops
 * entries too old to undo.
 */
export async function recordChange(
  tx: Pick<Db, "insert" | "delete">,
  change: {
    weekStart: string;
    userId: string | null;
    kind: PlanChangeKind;
    summary: string;
    before: PlanChangeSnapshot;
  }
): Promise<string> {
  await tx.delete(planChanges).where(lt(planChanges.createdAt, undoCutoff()));
  const [row] = await tx
    .insert(planChanges)
    .values(change)
    .returning({ id: planChanges.id });
  return row.id;
}

/** A week's most recent change that isn't undone and is recent enough to undo. */
export async function latestChange(db: Pick<Db, "select">, weekStart: string) {
  const [row] = await db
    .select({
      id: planChanges.id,
      summary: planChanges.summary,
      byName: users.name,
    })
    .from(planChanges)
    .leftJoin(users, eq(users.id, planChanges.userId))
    .where(
      and(
        eq(planChanges.weekStart, weekStart),
        isNull(planChanges.undoneAt),
        gte(planChanges.createdAt, undoCutoff())
      )
    )
    .orderBy(desc(planChanges.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Reverts a week's latest change from its snapshot. Meals it added that were
 * moved out of the week, deleted, or logged since stay, so an undo never
 * takes anyone's logs with it; `kept` counts the logged ones.
 */
export async function undoChange(
  db: Db,
  id: string
): Promise<{ weekStart: string; summary: string; kept: number }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ weekStart: planChanges.weekStart })
      .from(planChanges)
      .where(eq(planChanges.id, id));
    if (!target) {
      throw new PlanError("That change can't be undone any more");
    }
    await lockWeek(tx, target.weekStart);
    // Read again under the lock: another undo of it may have just finished.
    const [change] = await tx
      .select()
      .from(planChanges)
      .where(eq(planChanges.id, id));
    if (!change || change.createdAt < undoCutoff()) {
      throw new PlanError("That change can't be undone any more");
    }
    if (change.undoneAt) {
      throw new PlanError("That change was already undone");
    }
    if ((await latestChange(tx, change.weekStart))?.id !== id) {
      throw new PlanError("Undo the later change first");
    }

    const { weekStart, before } = change;
    let kept = 0;
    if (before.added.length > 0) {
      const inWeek = and(
        inArray(mealSlots.id, before.added),
        gte(mealSlots.date, weekStart),
        lt(mealSlots.date, addDays(weekStart, 7))
      );
      await tx.delete(mealSlots).where(
        and(
          inWeek,
          notExists(
            tx
              .select({ one: sql`1` })
              .from(adherence)
              .where(eq(adherence.mealSlotId, mealSlots.id))
          )
        )
      );
      // What's still in the week now is what had a log.
      [{ kept }] = await tx
        .select({ kept: sql<number>`count(*)::int` })
        .from(mealSlots)
        .where(inWeek);
    }

    // A row that's gone (its meal or person deleted) or edited since matches nothing.
    for (const p of before.portions) {
      await tx
        .update(slotPortions)
        .set({ multiplier: p.before })
        .where(
          and(
            eq(slotPortions.mealSlotId, p.mealSlotId),
            eq(slotPortions.userId, p.userId),
            eq(slotPortions.multiplier, p.after)
          )
        );
    }

    await tx
      .update(planChanges)
      .set({ undoneAt: sql`now()` })
      .where(eq(planChanges.id, id));
    return { weekStart, summary: change.summary, kept };
  });
}

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import "server-only";

import type { Db } from "./db/client";
import { mealSlots, planChanges, slotPortions, users } from "./db/schema";
import type { PlanChangeSnapshot } from "./domain/plan-change";
import { PlanError } from "./errors";
import { nextPosition } from "./plan-slots";

export type { PlanChangeSnapshot };

type PlanChangeKind = typeof planChanges.$inferInsert.kind;

const KEEP_DAYS = 30;

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
 * entries too old to be worth undoing.
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
  await tx
    .delete(planChanges)
    .where(
      lt(
        planChanges.createdAt,
        new Date(Date.now() - KEEP_DAYS * 24 * 3600 * 1000)
      )
    );
  const [row] = await tx
    .insert(planChanges)
    .values(change)
    .returning({ id: planChanges.id });
  return row.id;
}

/** A week's most recent change that isn't undone, if any (and not older than `since`). */
export async function latestChange(
  db: Pick<Db, "select">,
  weekStart: string,
  { since }: { since?: Date } = {}
) {
  const [row] = await db
    .select({
      id: planChanges.id,
      kind: planChanges.kind,
      summary: planChanges.summary,
      createdAt: planChanges.createdAt,
      byName: users.name,
    })
    .from(planChanges)
    .leftJoin(users, eq(users.id, planChanges.userId))
    .where(
      and(
        eq(planChanges.weekStart, weekStart),
        isNull(planChanges.undoneAt),
        since ? gte(planChanges.createdAt, since) : undefined
      )
    )
    .orderBy(desc(planChanges.createdAt))
    .limit(1);
  return row ?? null;
}

/** The latest change a day or less old: what the planner offers to undo. */
export const recentChange = (db: Pick<Db, "select">, weekStart: string) =>
  latestChange(db, weekStart, {
    since: new Date(Date.now() - 24 * 3600 * 1000),
  });

/**
 * Reverts a week's latest change from its snapshot. Meals deleted by hand
 * since are skipped, not brought back. Removing a meal the change added also
 * removes anything logged on it since, and a meal it removed comes back
 * without its logs: the snapshot doesn't keep them.
 */
export async function undoChange(
  db: Db,
  id: string
): Promise<{ weekStart: string; summary: string }> {
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
    if (!change) {
      throw new PlanError("That change can't be undone any more");
    }
    if (change.undoneAt) {
      throw new PlanError("That change was already undone");
    }
    const [later] = await tx
      .select({ id: planChanges.id })
      .from(planChanges)
      .where(
        and(
          eq(planChanges.weekStart, change.weekStart),
          isNull(planChanges.undoneAt),
          // Compared in SQL: a JS Date drops the column's microseconds.
          sql`${planChanges.createdAt} > (select created_at from plan_changes where id = ${id})`
        )
      )
      .limit(1);
    if (later) {
      throw new PlanError("Undo the later change first");
    }

    const { added, removed, portions } = change.before;
    if (added.length > 0) {
      await tx.delete(mealSlots).where(inArray(mealSlots.id, added));
    }

    const people = new Set(
      (await tx.select({ id: users.id }).from(users)).map((u) => u.id)
    );
    for (const { meal, portions: mealPortions } of removed) {
      const [exists] = await tx
        .select({ id: mealSlots.id })
        .from(mealSlots)
        .where(eq(mealSlots.id, meal.id));
      if (exists) {
        continue;
      }
      const [taken] = await tx
        .select({ id: mealSlots.id })
        .from(mealSlots)
        .where(
          and(
            eq(mealSlots.date, meal.date),
            eq(mealSlots.slot, meal.slot),
            eq(mealSlots.snackIndex, meal.snackIndex),
            eq(mealSlots.position, meal.position)
          )
        );
      await tx.insert(mealSlots).values({
        id: meal.id,
        date: meal.date,
        slot: meal.slot,
        snackIndex: meal.snackIndex,
        position: taken
          ? await nextPosition(tx, meal.date, meal.slot, meal.snackIndex)
          : meal.position,
        mealieRecipeSlug: meal.slug,
        baseServings: meal.baseServings,
        unplanned: meal.unplanned,
        createdBy:
          meal.createdBy && people.has(meal.createdBy) ? meal.createdBy : null,
      });
      const rows = mealPortions
        .filter((p) => people.has(p.userId))
        .map((p) => ({ mealSlotId: meal.id, ...p }));
      if (rows.length > 0) {
        await tx.insert(slotPortions).values(rows);
      }
    }

    if (portions.length > 0) {
      const alive = new Set(
        (
          await tx
            .select({ id: mealSlots.id })
            .from(mealSlots)
            .where(
              inArray(
                mealSlots.id,
                portions.map((p) => p.mealSlotId)
              )
            )
        ).map((m) => m.id)
      );
      const rows = portions.filter(
        (p) => alive.has(p.mealSlotId) && people.has(p.userId)
      );
      if (rows.length > 0) {
        await tx
          .insert(slotPortions)
          .values(rows)
          .onConflictDoUpdate({
            target: [slotPortions.mealSlotId, slotPortions.userId],
            set: { multiplier: sql`excluded.multiplier` },
          });
      }
    }

    await tx
      .update(planChanges)
      .set({ undoneAt: new Date() })
      .where(eq(planChanges.id, id));
    return { weekStart: change.weekStart, summary: change.summary };
  });
}

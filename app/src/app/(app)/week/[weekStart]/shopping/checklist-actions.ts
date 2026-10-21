"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isDbUnreachable } from "@/server/db/errors";
import { weekStartSchema } from "@/server/domain/week";
import { RetryableError } from "@/server/errors";
import {
  addShopExtra,
  checkShopExtra,
  checkShopLine,
  hideShopLine,
  removeShopExtra,
} from "@/server/shop";

// A plan line's key is a food id, `recipeId|text` or `recipeId|product`, all starting with a Mealie uuid. Ticks
// don't recompute the week's plan to check it: the row is keyed by week and
// key and only ever shown for a line on that week's plan, so an unknown key
// affects nothing, and recomputing the plan would slow every tick down. The
// length only stops runaway input: a recipe's free text can run long.
const lineKey = z
  .string()
  .max(10_000)
  .regex(/^[0-9a-f-]{36}(\|[\s\S]+)?$/);
const extraId = z.uuid();
const amounts = z
  .array(
    z.object({
      quantity: z.number().finite().min(0),
      unit: z.string().max(200).nullable(),
    })
  )
  .max(50);

/**
 * Runs a change and refreshes the page. The action's response then carries
 * the updated list, so the browser never shows a stale copy.
 */
async function saved(week: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
    revalidatePath(`/week/${week}/shopping`);
  } catch (err) {
    // Dropping the changes would lose ticks made in the shop, so a database
    // that is down keeps the device's queue.
    if (isDbUnreachable(err)) {
      console.error("shop list change failed", err);
      throw new RetryableError(
        "The planner can't reach its database. Your changes will save when it's back."
      );
    }
    throw err;
  }
}

export const checkShopItemAction = userAction(
  z
    .object({ weekStart: weekStartSchema, checked: z.boolean() })
    .and(
      z.discriminatedUnion("source", [
        z.object({ source: z.literal("plan"), itemId: lineKey, amounts }),
        z.object({ source: z.literal("extra"), itemId: extraId, amounts }),
      ])
    ),
  async (data, user) => {
    const db = getDb();
    await saved(data.weekStart, () =>
      data.source === "plan"
        ? checkShopLine(db, {
            weekStart: data.weekStart,
            userId: user.id,
            lineKey: data.itemId,
            checked: data.checked,
            amounts: data.amounts,
          })
        : checkShopExtra(db, {
            weekStart: data.weekStart,
            id: data.itemId,
            checked: data.checked,
          })
    );
    return {};
  }
);

export const addShopItemAction = userAction(
  z.object({
    weekStart: weekStartSchema,
    itemId: extraId,
    text: z.string().trim().min(1).max(200),
  }),
  async (data, user) => {
    await saved(data.weekStart, () =>
      addShopExtra(getDb(), {
        weekStart: data.weekStart,
        userId: user.id,
        id: data.itemId,
        text: data.text,
      })
    );
    return {};
  }
);

export const removeShopItemAction = userAction(
  z
    .object({ weekStart: weekStartSchema })
    .and(
      z.discriminatedUnion("source", [
        z.object({ source: z.literal("plan"), itemId: lineKey, amounts }),
        z.object({ source: z.literal("extra"), itemId: extraId }),
      ])
    ),
  async (data, user) => {
    const db = getDb();
    await saved(data.weekStart, () =>
      data.source === "plan"
        ? hideShopLine(db, {
            weekStart: data.weekStart,
            userId: user.id,
            lineKey: data.itemId,
            amounts: data.amounts,
          })
        : removeShopExtra(db, { weekStart: data.weekStart, id: data.itemId })
    );
    return {};
  }
);

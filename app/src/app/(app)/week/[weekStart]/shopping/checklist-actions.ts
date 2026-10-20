"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isDbUnreachable } from "@/server/db/errors";
import { weekStartSchema } from "@/server/domain/week";
import { RetryableError, UserFacingError } from "@/server/errors";
import { isMealieUnavailable, MealieError } from "@/server/mealie/client";
import { addShopItem, checkShopItem, removeShopItem } from "@/server/shop";

const itemId = z.uuid();

/**
 * Runs a Mealie change and refreshes the page. The action's response then
 * carries the updated list, so the browser never shows a stale copy.
 */
async function viaMealie<T>(week: string, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    revalidatePath(`/week/${week}/shopping`);
    return result;
  } catch (err) {
    // Errors that go away on their own keep the device's queue; dropping the
    // changes would lose ticks made in the shop.
    if (isMealieUnavailable(err)) {
      console.error("shop list change failed", err);
      throw new RetryableError(
        "Mealie didn't answer. Your changes will save when it's back."
      );
    }
    if (err instanceof MealieError && [401, 403].includes(err.status)) {
      console.error("Mealie refused the planner's token", err);
      throw new RetryableError(
        "Mealie refused the planner's access. Your changes are kept until that's fixed."
      );
    }
    if (isDbUnreachable(err)) {
      console.error("shop list change failed", err);
      throw new RetryableError(
        "The planner can't reach its database. Your changes will save when it's back."
      );
    }
    if (err instanceof MealieError) {
      console.error("Mealie refused a shop list change", err);
      throw new UserFacingError("Mealie refused that change.");
    }
    throw err;
  }
}

export const checkShopItemAction = userAction(
  z.object({ weekStart: weekStartSchema, itemId, checked: z.boolean() }),
  async (data) => {
    await viaMealie(data.weekStart, () =>
      checkShopItem(getDb(), data.weekStart, data.itemId, data.checked)
    );
    return {};
  }
);

export const addShopItemAction = userAction(
  z.object({
    weekStart: weekStartSchema,
    text: z.string().trim().min(1).max(200),
  }),
  async (data) => {
    const item = await viaMealie(data.weekStart, () =>
      addShopItem(getDb(), data.weekStart, data.text)
    );
    return { item: { id: item.id } };
  }
);

export const removeShopItemAction = userAction(
  z.object({ weekStart: weekStartSchema, itemId }),
  async (data) => {
    await viaMealie(data.weekStart, () =>
      removeShopItem(getDb(), data.weekStart, data.itemId)
    );
    return {};
  }
);

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
import { RetryableError, UserFacingError } from "@/server/errors";
import { isMealieUnavailable, MealieError } from "@/server/mealie/client";
import type { ShoppingItem } from "@/server/mealie/shopping";
import { addShopItem, checkShopItem, removeShopItem } from "@/server/shopping";

const weekStart = z
  .string()
  .refine((d) => isIsoDate(d) && weekStartOf(d) === d, "invalid week");
const itemId = z.uuid();

/**
 * Runs a Mealie change and refreshes the page. The action's response then
 * carries the updated list, so the browser never shows a stale copy.
 */
async function viaMealie<T>(week: string, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    revalidatePath(`/week/${week}/shop`);
    return result;
  } catch (err) {
    if (isMealieUnavailable(err)) {
      console.error("shop list change failed", err);
      throw new RetryableError(
        "Mealie didn't answer. Your changes will save when it's back."
      );
    }
    if (err instanceof MealieError) {
      console.error("Mealie refused a shop list change", err);
      throw new UserFacingError("Mealie refused that change.");
    }
    throw err;
  }
}

const view = (item: ShoppingItem) => ({ id: item.id, checked: item.checked });

export const checkShopItemAction = userAction(
  z.object({ weekStart, itemId, checked: z.boolean() }),
  async (data) => {
    await viaMealie(data.weekStart, () =>
      checkShopItem(getDb(), data.weekStart, data.itemId, data.checked)
    );
    return {};
  }
);

export const addShopItemAction = userAction(
  z.object({
    weekStart,
    text: z.string().trim().min(1).max(200),
    clientId: z.string().regex(/^local-[0-9a-f-]{36}$/),
  }),
  async (data) => ({
    item: view(
      await viaMealie(data.weekStart, () =>
        addShopItem(getDb(), data.weekStart, data.text, data.clientId)
      )
    ),
  })
);

export const removeShopItemAction = userAction(
  z.object({ weekStart, itemId }),
  async (data) => {
    await viaMealie(data.weekStart, () =>
      removeShopItem(getDb(), data.weekStart, data.itemId)
    );
    return {};
  }
);

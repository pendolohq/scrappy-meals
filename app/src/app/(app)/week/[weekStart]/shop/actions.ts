"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
import { UserFacingError } from "@/server/errors";
import { MealieError } from "@/server/mealie/client";
import type { ShoppingItem } from "@/server/mealie/shopping";
import { addShopItem, checkShopItem, removeShopItem } from "@/server/shopping";

const weekStart = z
  .string()
  .refine((d) => isIsoDate(d) && weekStartOf(d) === d, "invalid week");
const itemId = z.uuid();

/** Mealie being down is worth telling the user; the rest stays generic. */
async function viaMealie<T>(week: string, work: () => Promise<T>): Promise<T> {
  try {
    const result = await work();
    revalidatePath(`/week/${week}/shop`);
    return result;
  } catch (err) {
    if (err instanceof MealieError || (err as Error).name === "TimeoutError") {
      console.error("shop list change failed", err);
      throw new UserFacingError("Mealie didn't answer. Try again in a moment.");
    }
    throw err;
  }
}

const view = (item: ShoppingItem) => ({ id: item.id, checked: item.checked });

export const checkShopItemAction = userAction(
  z.object({ weekStart, itemId, checked: z.boolean() }),
  async (data) => ({
    item: view(
      await viaMealie(data.weekStart, () =>
        checkShopItem(getDb(), data.weekStart, data.itemId, data.checked)
      )
    ),
  })
);

export const addShopItemAction = userAction(
  z.object({ weekStart, text: z.string().trim().min(1).max(200) }),
  async (data) => ({
    item: view(
      await viaMealie(data.weekStart, () =>
        addShopItem(getDb(), data.weekStart, data.text)
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

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userFormAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
import { UserFacingError } from "@/server/errors";
import { isMealieUnavailable, MealieError } from "@/server/mealie/client";
import { pushShoppingList } from "@/server/shopping";

export type PushState = {
  error?: string;
  ok?: {
    added: number;
    replaced: number;
    merged: number;
    listName: string;
  };
};

const fromForm = z.preprocess(
  (form) =>
    form instanceof FormData ? { weekStart: form.get("weekStart") } : form,
  z.object({
    weekStart: z
      .string()
      .refine((d) => isIsoDate(d) && weekStartOf(d) === d, "invalid week"),
  })
);

export const pushShoppingAction = userFormAction(
  fromForm,
  async ({ weekStart }) => {
    try {
      const res = await pushShoppingList(getDb(), weekStart);
      revalidatePath(`/week/${weekStart}/shopping`);
      revalidatePath(`/week/${weekStart}/shop`);
      return { ok: res };
    } catch (err) {
      if (isMealieUnavailable(err)) {
        console.error("shopping push failed", err);
        throw new UserFacingError(
          "Mealie didn't answer. The list may be partly updated: send it again once Mealie is back."
        );
      }
      if (err instanceof MealieError) {
        console.error("Mealie refused the shopping list", err);
        throw new UserFacingError(
          "Mealie didn't accept the list. It may be partly updated: try sending it again."
        );
      }
      throw err;
    }
  },
  { invalid: () => "Invalid week" }
);

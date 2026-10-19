"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userFormAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
import { UserFacingError } from "@/server/errors";
import { MealieError } from "@/server/mealie/client";
import { pushShoppingList } from "@/server/shopping";

export type PushState = {
  error?: string;
  ok?: {
    added: number;
    replaced: number;
    listName: string;
    url: string | null;
  };
};

const fromForm = z.preprocess(
  (form) => (form instanceof FormData ? { weekStart: form.get("weekStart") } : form),
  z.object({
    weekStart: z.string().refine((d) => isIsoDate(d) && weekStartOf(d) === d, "invalid week"),
  }),
);

export const pushShoppingAction = userFormAction(
  fromForm,
  async ({ weekStart }) => {
    try {
      const res = await pushShoppingList(getDb(), weekStart);
      revalidatePath(`/week/${weekStart}/shopping`);
      const base = process.env.MEALIE_PUBLIC_URL?.replace(/\/$/, "");
      return {
        ok: { ...res, url: base ? `${base}/shopping-lists/${res.listId}` : null },
      };
    } catch (err) {
      if (err instanceof MealieError || (err as Error).name === "TimeoutError") {
        console.error("shopping push failed", err);
        throw new UserFacingError("Mealie didn't accept the list. Is it running? Nothing was changed on our side.");
      }
      throw err;
    }
  },
  { invalid: () => "Invalid week" },
);

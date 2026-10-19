"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { getDb } from "@/server/db/client";
import { isIsoDate, weekStartOf } from "@/server/domain/week";
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

export async function pushShoppingAction(
  _prev: PushState,
  form: FormData,
): Promise<PushState> {
  if (!(await auth())?.user)
    return { error: "You are signed out. Reload the page." };
  const weekStart = String(form.get("weekStart") ?? "");
  if (!isIsoDate(weekStart) || weekStartOf(weekStart) !== weekStart)
    return { error: "Invalid week" };

  try {
    const res = await pushShoppingList(getDb(), weekStart);
    revalidatePath(`/week/${weekStart}/shopping`);
    const base = process.env.MEALIE_PUBLIC_URL?.replace(/\/$/, "");
    return {
      ok: { ...res, url: base ? `${base}/shopping-lists/${res.listId}` : null },
    };
  } catch (err) {
    console.error("shopping push failed", err);
    return {
      error:
        err instanceof MealieError || (err as Error).name === "TimeoutError"
          ? "Mealie didn't accept the list. Is it running? Nothing was changed on our side."
          : "Something went wrong. Try again.",
    };
  }
}

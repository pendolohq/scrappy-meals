"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { parseBarcode } from "@/server/domain/barcode";
import { UserFacingError } from "@/server/errors";
import { retryContribution } from "@/server/off-contribute";

/** Sends a product that Open Food Facts didn't take the first time again. */
export const retryContributionAction = userAction(
  z.object({ barcode: z.string().max(32) }),
  async ({ barcode: input }, user) => {
    const barcode = parseBarcode(input);
    if (!barcode) {
      throw new UserFacingError("That doesn't look like a barcode");
    }
    const outcome = await retryContribution(getDb(), barcode, user.id);
    revalidatePath("/recipes/[slug]", "page");
    revalidatePath("/week/[weekStart]/meals/[mealId]", "page");
    return { outcome };
  }
);

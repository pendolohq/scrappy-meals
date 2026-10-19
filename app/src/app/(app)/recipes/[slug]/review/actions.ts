"use server";

import { z } from "zod";

import { userAction } from "@/server/action";
import { reviewInputSchema } from "@/server/domain/review-input";
import { saveReview } from "@/server/recipe-review";

const schema = reviewInputSchema.extend({ slug: z.string().min(1).max(200) });

const MESSAGES: Record<string, string> = {
  servings: "Servings must be a number above 0.",
  nutrition: "Nutrition values must be numbers, 0 or more.",
  lines: "Check the ingredient amounts: they must be numbers, 0 or more.",
};

// Plan edits are household-wide: any signed-in user may review any recipe.
export const saveReviewAction = userAction(
  schema,
  async ({ slug, ...input }) => {
    await saveReview(slug, input);
    return { saved: true as const };
  },
  {
    invalid: (err) =>
      MESSAGES[String(err.issues[0].path[0])] ?? "Invalid input",
  }
);

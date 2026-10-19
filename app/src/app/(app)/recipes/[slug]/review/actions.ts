"use server";

import { z } from "zod";

import { userAction } from "@/server/action";
import { reviewInputSchema } from "@/server/domain/review-input";
import { saveReview } from "@/server/recipe-review";

const schema = reviewInputSchema.extend({
  slug: z
    .string()
    .max(200)
    .regex(/^[a-z0-9-]+$/),
});

/** The first problem, in words the person can act on. */
function explain(err: z.ZodError): string {
  const [area, , field] = err.issues[0].path;
  if (area === "servings") {
    return "Servings must be a number above 0 and at most 1000.";
  }
  if (area === "nutrition") {
    return "Nutrition values must be numbers, 0 or more.";
  }
  if (area === "lines" && field === "quantity") {
    return "Ingredient amounts must be numbers from 0 to 10000.";
  }
  if (area === "lines") {
    return "An ingredient line is too long, or there are more than 200.";
  }
  return "Invalid input";
}

// Plan edits are household-wide: any signed-in user may review any recipe.
export const saveReviewAction = userAction(
  schema,
  async ({ slug, ...input }) => {
    await saveReview(slug, input);
    return { saved: true as const };
  },
  { invalid: explain }
);

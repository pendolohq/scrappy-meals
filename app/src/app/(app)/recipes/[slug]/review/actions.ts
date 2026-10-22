"use server";

import { z } from "zod";

import { userAction } from "@/server/action";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { reviewInputSchema } from "@/server/domain/review-input";
import { estimateForReview } from "@/server/nutrition-estimate";
import { saveReview } from "@/server/recipe-review";

const schema = reviewInputSchema.extend({ slug: recipeSlug });

/** The first problem, in words the person can act on. */
function explain(err: z.ZodError): string {
  const [area, , field] = err.issues[0].path;
  if (area === "servings") {
    return "Servings must be a number above 0 and at most 1000.";
  }
  if (area === "totalMinutes") {
    return "Total time must be a whole number of minutes, from 1 to 10000.";
  }
  if (area === "tags" || area === "categories") {
    return "Pick tags and categories from the list.";
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

const estimateSchema = z.object({
  name: z.string().max(300),
  servings: z.number().positive().max(1000).nullable(),
  ingredients: z.array(z.string().max(500)).min(1).max(200),
});

// Nothing is saved: the form shows the numbers and the review saves them.
export const estimateNutritionAction = userAction(
  estimateSchema,
  async (input, user) => ({
    estimate: await estimateForReview(input, user.id),
  }),
  { invalid: () => "Add some ingredients to estimate from." }
);

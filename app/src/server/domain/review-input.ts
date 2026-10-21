import { z } from "zod";

import { RECIPE_CATEGORIES, RECIPE_TAGS } from "./taxonomy";

const slugs = <T extends string>(list: readonly { slug: T }[]) =>
  z.array(z.enum(list.map((o) => o.slug) as [T, ...T[]])).max(list.length);

const macro = z.number().min(0).nullable();

/** What the review form submits; the action adds the recipe's slug. */
export const reviewInputSchema = z.object({
  servings: z.number().positive().max(1000),
  /** Whole minutes; null leaves the recipe without a total time. */
  totalMinutes: z.int().min(1).max(10_000).nullable(),
  /** The agreed tags and categories the recipe should carry. */
  tags: slugs(RECIPE_TAGS),
  categories: slugs(RECIPE_CATEGORIES),
  nutrition: z.object({
    kcal: macro,
    protein: macro,
    carbs: macro,
    fat: macro,
    fibre: macro,
  }),
  lines: z
    .array(
      z.object({
        // The line's key from the page; the server matches it to Mealie's own
        // ingredient and carries that one's hidden fields over.
        referenceId: z.string().max(64).nullish(),
        title: z.string().max(200).nullable(),
        asText: z.boolean(),
        quantity: z.number().min(0).max(10_000).nullable(),
        unit: z.string().max(200).nullable(),
        food: z.string().max(200).nullable(),
        note: z.string().max(1000),
      })
    )
    .max(200),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

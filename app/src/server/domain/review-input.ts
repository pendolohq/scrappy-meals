import { z } from "zod";

const macro = z.number().min(0).nullable();

/** What the review form submits; the action adds the recipe's slug. */
export const reviewInputSchema = z.object({
  servings: z.number().positive(),
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
        title: z.string().max(200).nullable(),
        asText: z.boolean(),
        quantity: z.number().min(0).nullable(),
        unit: z.string().max(200).nullable(),
        food: z.string().max(200).nullable(),
        note: z.string().max(1000),
      })
    )
    .max(200),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

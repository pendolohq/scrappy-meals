"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { recipeSlug } from "@/server/domain/recipe-slug";
import {
  confirmMatch,
  saveDecision,
  searchUsda,
  suggestNext,
} from "@/server/usda/check";

const BASE = "/recipes/nutrition-check";

// Foods and their matches are household-wide, like plan edits: anyone signed
// in may match a food or decide a recipe.

export const suggestMatchesAction = userAction(
  z.object({}),
  async (_, user) => {
    const result = await suggestNext(getDb(), user.id, after);
    revalidatePath(BASE, "layout");
    return result;
  }
);

export const searchUsdaAction = userAction(
  z.object({ query: z.string().trim().min(2).max(100) }),
  async ({ query }, user) => ({ hits: await searchUsda(query, user.id) }),
  { invalid: () => "Type at least two letters to search." }
);

export const confirmMatchAction = userAction(
  z.object({
    foodId: z.uuid(),
    fdcId: z.number().int().positive(),
    pieceGrams: z.number().min(0.001).max(10_000).nullable(),
    pieceLabel: z.string().trim().max(100).nullable(),
  }),
  async (input, user) => {
    await confirmMatch(getDb(), input, user.id);
    revalidatePath(BASE, "layout");
    return { saved: true as const };
  },
  { invalid: () => "The weight of one must be a number of grams above 0." }
);

const macro = z.number().min(0).max(100_000);

// Only an edit carries values: the other choices are decided on the server,
// from Mealie's own figures and the USDA figures it computes.
export const saveDecisionAction = userAction(
  z.discriminatedUnion("choice", [
    z.object({ slug: recipeSlug, choice: z.enum(["mealie", "usda"]) }),
    z.object({
      slug: recipeSlug,
      choice: z.literal("edited"),
      values: z.object({
        kcal: macro.optional(),
        protein: macro.optional(),
        carbs: macro.optional(),
        fat: macro.optional(),
        fibre: macro.optional(),
      }),
    }),
  ]),
  async ({ slug, ...decision }, user) => {
    await saveDecision(slug, decision, user.id);
    revalidatePath(BASE, "layout");
    return { saved: true as const };
  },
  { invalid: () => "Nutrition values must be numbers, 0 or more." }
);

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { recipeSlug } from "@/server/domain/recipe-slug";
import {
  confirmMatch,
  saveDecision,
  saveOwnValues,
  searchUsda,
  suggestNext,
} from "@/server/usda/check";

const BASE = "/recipes/nutrition-check";

// Foods and their matches are household-wide, like plan edits: anyone signed
// in may match a food or decide a recipe.

export const suggestMatchesAction = userAction(
  z.object({}),
  async (_, user) => {
    const result = await suggestNext(getDb(), user.id);
    revalidatePath(BASE, "layout");
    return result;
  }
);

export const searchUsdaAction = userAction(
  z.object({ query: z.string().trim().min(2).max(100) }),
  async ({ query }, user) => ({ hits: await searchUsda(query, user.id) }),
  { invalid: () => "Type at least two letters to search." }
);

const weight = z.number().min(0.001).max(10_000);

export const confirmMatchAction = userAction(
  z.object({
    foodId: z.uuid(),
    fdcId: z.number().int().positive(),
    pieceGrams: weight.nullable(),
    pieceLabel: z.string().trim().max(100).nullable(),
    unitGrams: z
      .record(z.string().trim().min(1).max(40), weight)
      .refine((r) => Object.keys(r).length <= 20),
    defaultGrams: weight.nullable(),
  }),
  async (input, user) => {
    await confirmMatch(getDb(), input, user.id);
    revalidatePath(BASE, "layout");
    return { saved: true as const };
  },
  { invalid: () => "Each weight must be a number of grams above 0." }
);

// Per 100 g, so no macro can weigh more than the 100 g it's part of.
const per100g = z.number().min(0).max(100);

export const saveOwnValuesAction = userAction(
  z.object({
    foodId: z.uuid(),
    per100g: z.object({
      kcal: z.number().min(0).max(900),
      protein: per100g,
      carbs: per100g,
      fat: per100g,
      fibre: per100g,
    }),
    gramsPerTbsp: z.number().min(0.1).max(100).nullable(),
    pieceGrams: weight.nullable(),
    unitGrams: z
      .record(z.string().trim().min(1).max(40), weight)
      .refine((r) => Object.keys(r).length <= 20),
    defaultGrams: weight.nullable(),
  }),
  async (input, user) => {
    await saveOwnValues(getDb(), input, user.id);
    revalidatePath(BASE, "layout");
    return { saved: true as const };
  },
  {
    invalid: () =>
      "Enter every value per 100 g: calories up to 900, the rest up to 100 g.",
  }
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

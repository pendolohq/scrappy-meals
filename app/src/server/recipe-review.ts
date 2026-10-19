import "server-only";

import { getDb } from "./db/client";
import type { ReviewInput } from "./domain/review-input";
import { RetryableError, UserFacingError } from "./errors";
import { isTransient, mealie, unwrap } from "./mealie/client";
import {
  findOrCreateFood,
  findOrCreateUnit,
  getRawRecipe,
  type ParsedLine,
  parseIngredients,
  patchRecipe,
} from "./mealie/import";
import { readImportState, withImportState } from "./mealie/import-state";
import type { ImportState } from "./mealie/import-state";
import type { MacroKey } from "./mealie/nutrition";
import { normaliseNutrition } from "./mealie/nutrition";
import { loadRecipes } from "./recipe-cache";

type RawIngredient = {
  referenceId?: string | null;
  originalText?: string | null;
  note?: string | null;
  display?: string | null;
  title?: string | null;
  quantity?: number | null;
  unit?: { id?: string | null; name: string } | null;
  food?: { id?: string | null; name: string } | null;
};

type RawRecipe = {
  name: string;
  recipeServings?: number | null;
  orgURL?: string | null;
  nutrition?: Record<string, string | null> | null;
  extras?: Record<string, unknown> | null;
  recipeIngredient?: RawIngredient[] | null;
};

type Deps = {
  getRecipe: (slug: string) => Promise<RawRecipe | null>;
  parse: (lines: string[]) => Promise<ParsedLine[]>;
  groupSlug: () => Promise<string>;
  publicUrl: string | null;
  findOrCreateFood: (name: string) => Promise<{ id: string; name: string }>;
  findOrCreateUnit: (name: string) => Promise<{ id: string; name: string }>;
  patch: (
    slug: string,
    fields: Parameters<typeof patchRecipe>[1]
  ) => Promise<void>;
  refresh: (slug: string) => Promise<void>;
};

export type ReviewLine = {
  key: string;
  original: string;
  title: string | null;
  quantity: number | null;
  unit: string | null;
  food: string | null;
  note: string;
  /** Null for lines Mealie already had parsed. */
  confidence: number | null;
  /** True when the parser found no food: the line stays plain text. */
  asText: boolean;
};

export type ReviewDraft = {
  slug: string;
  name: string;
  servings: number | null;
  sourceUrl: string | null;
  mealieUrl: string | null;
  importState: ImportState;
  nutrition: Record<MacroKey, number | null>;
  lines: ReviewLine[];
};

let cachedGroupSlug: Promise<string> | undefined;

// The group never changes while the app runs; a failed lookup is retried.
const groupSlug = () => {
  cachedGroupSlug ??= mealie()
    .GET("/api/groups/self")
    .then((r) => unwrap(r).slug)
    .catch((err: unknown) => {
      cachedGroupSlug = undefined;
      throw err;
    });
  return cachedGroupSlug;
};

const defaults = (): Deps => ({
  getRecipe: async (slug) => {
    const recipe = await getRawRecipe(slug);
    return recipe && { ...recipe, name: recipe.name || slug };
  },
  parse: (lines) => parseIngredients(lines),
  groupSlug,
  publicUrl: process.env.MEALIE_PUBLIC_URL || null,
  findOrCreateFood: (name) => findOrCreateFood(name),
  findOrCreateUnit: (name) => findOrCreateUnit(name),
  patch: (slug, fields) => patchRecipe(slug, fields),
  refresh: async (slug) => {
    await loadRecipes(getDb(), [slug], { force: true });
  },
});

const isParsed = (i: RawIngredient) => Boolean(i.food?.id || i.unit?.id);

const originalOf = (i: RawIngredient) =>
  i.originalText || i.note || i.display || i.food?.name || "";

/** Mealie down: callers that queue changes keep them and try again. */
async function whenMealieAnswers<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isTransient(err)) {
      console.error("recipe review failed", err);
      throw new RetryableError("Mealie didn't answer. Try again in a minute.");
    }
    throw err;
  }
}

/**
 * Everything the review page shows. Only lines Mealie has not parsed yet go
 * through the parser, in one call.
 */
export async function loadReview(
  slug: string,
  deps: Partial<Deps> = {}
): Promise<ReviewDraft | null> {
  const d = { ...defaults(), ...deps };
  return whenMealieAnswers(async () => {
    const recipe = await d.getRecipe(slug);
    if (!recipe) {
      return null;
    }
    const raw = recipe.recipeIngredient ?? [];
    const unparsed = raw.filter((i) => !isParsed(i));
    const parsed =
      unparsed.length > 0 ? await d.parse(unparsed.map(originalOf)) : [];
    let next = 0;

    const lines = raw.map((i, index): ReviewLine => {
      const base = {
        key: i.referenceId || String(index),
        original: originalOf(i),
        title: i.title || null,
      };
      if (isParsed(i)) {
        return {
          ...base,
          quantity: i.quantity || null,
          unit: i.unit?.name ?? null,
          food: i.food?.name ?? null,
          note: i.note ?? "",
          confidence: null,
          asText: false,
        };
      }
      const p = parsed[next++];
      return {
        ...base,
        quantity: p.quantity,
        unit: p.unit?.name ?? null,
        food: p.food?.name ?? null,
        note: p.note,
        confidence: p.confidence,
        asText: p.food === null,
      };
    });

    const base = d.publicUrl?.replace(/\/$/, "");
    const { perServing } = normaliseNutrition(recipe.nutrition);
    return {
      slug,
      name: recipe.name,
      servings: recipe.recipeServings || null,
      sourceUrl: recipe.orgURL || null,
      mealieUrl: base ? `${base}/g/${await d.groupSlug()}/r/${slug}` : null,
      importState: readImportState(recipe.extras),
      nutrition: {
        kcal: perServing.kcal ?? null,
        protein: perServing.protein ?? null,
        carbs: perServing.carbs ?? null,
        fat: perServing.fat ?? null,
        fibre: perServing.fibre ?? null,
      },
      lines,
    };
  });
}

const NUTRITION_FIELDS = {
  kcal: "calories",
  protein: "proteinContent",
  carbs: "carbohydrateContent",
  fat: "fatContent",
  fibre: "fiberContent",
} as const;

const keyOf = (name: string) => name.trim().toLowerCase();

/** Resolves each distinct name once; the map is keyed by trimmed lowercase. */
async function resolveAll(
  names: (string | null)[],
  resolve: (name: string) => Promise<{ id: string; name: string }>
) {
  const distinct = new Map<string, string>();
  for (const name of names) {
    if (name?.trim() && !distinct.has(keyOf(name))) {
      distinct.set(keyOf(name), name.trim());
    }
  }
  const entries = await Promise.all(
    [...distinct].map(
      async ([key, name]) => [key, await resolve(name)] as const
    )
  );
  return new Map(entries);
}

/**
 * Writes the reviewed recipe back to Mealie in one PATCH, creating the foods
 * and units the lines name that Mealie doesn't have yet.
 */
export async function saveReview(
  slug: string,
  input: ReviewInput,
  deps: Partial<Deps> = {}
): Promise<void> {
  const d = { ...defaults(), ...deps };
  await whenMealieAnswers(async () => {
    const recipe = await d.getRecipe(slug);
    if (!recipe) {
      throw new UserFacingError("That recipe no longer exists in Mealie.");
    }

    const real = input.lines.filter((l) => !l.asText && l.food?.trim());
    const [foods, units] = await Promise.all([
      resolveAll(
        real.map((l) => l.food),
        d.findOrCreateFood
      ),
      resolveAll(
        real.map((l) => l.unit),
        d.findOrCreateUnit
      ),
    ]);

    const recipeIngredient = input.lines.map((l) => {
      if (l.asText || !l.food?.trim()) {
        return { title: l.title, quantity: 0, note: l.note };
      }
      const unit = l.unit?.trim() ? units.get(keyOf(l.unit)) : undefined;
      const food = foods.get(keyOf(l.food))!;
      return {
        title: l.title,
        quantity: l.quantity ?? 0,
        unit: unit ? { id: unit.id, name: unit.name } : null,
        food: { id: food.id, name: food.name },
        note: l.note,
      };
    });

    const nutrition: Record<string, string | null> = {
      ...recipe.nutrition,
    };
    for (const [macro, field] of Object.entries(NUTRITION_FIELDS)) {
      const value = input.nutrition[macro as MacroKey];
      nutrition[field] = value === null ? null : String(value);
    }
    const anyMacro = Object.values(input.nutrition).some((v) => v !== null);

    await d.patch(slug, {
      recipeServings: input.servings,
      nutrition,
      recipeIngredient,
      extras: withImportState(recipe.extras, {
        review: "done",
        nutrition: anyMacro ? "reviewed" : null,
      }),
    });
    await d.refresh(slug);
  });
}

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
import {
  IMPORT_EXTRAS,
  readImportState,
  withImportState,
} from "./mealie/import-state";
import type { ImportState } from "./mealie/import-state";
import {
  MACRO_KEYS,
  type MacroKey,
  normaliseNutrition,
} from "./mealie/nutrition";
import type { components } from "./mealie/schema";
import { loadRecipes } from "./recipe-cache";

type Ingredient = components["schemas"]["RecipeIngredient-Input"];

type RawIngredient = {
  referenceId?: string | null;
  originalText?: string | null;
  note?: string | null;
  display?: string | null;
  title?: string | null;
  quantity?: number | null;
  unit?: { id?: string | null; name: string } | null;
  food?: { id?: string | null; name: string } | null;
  // Carried over untouched on save, never read from the browser.
  referencedRecipe?: unknown;
  substitutions?: unknown[] | null;
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
  /** A linked recipe: shown, not editable here. */
  linked?: true;
};

export type ReviewDraft = {
  slug: string;
  name: string;
  servings: number | null;
  sourceUrl: string | null;
  mealieUrl: string | null;
  importState: ImportState;
  nutrition: Record<MacroKey, number | null>;
  /** Text Mealie has for a macro that can't be read as a number ("10-12"). */
  unreadableNutrition: Partial<Record<MacroKey, string>>;
  lines: ReviewLine[];
};

const NUTRITION_FIELDS = {
  kcal: "calories",
  protein: "proteinContent",
  carbs: "carbohydrateContent",
  fat: "fatContent",
  fibre: "fiberContent",
} as const;

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

// A linked recipe has no food of its own and must stay as it is.
const isParsed = (i: RawIngredient) =>
  Boolean(i.food?.id || i.unit?.id || i.referencedRecipe);

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
    // Once reviewed, a line without a food is the person's choice to keep it
    // as text; the parser only makes suggestions for recipes still to review.
    const reviewed = recipe.extras?.[IMPORT_EXTRAS.review] === "done";
    const unparsed = reviewed
      ? []
      : raw.filter((i) => !isParsed(i) && originalOf(i) !== "");
    const results =
      unparsed.length > 0 ? await d.parse(unparsed.map(originalOf)) : [];
    // A short answer from the parser leaves the remaining lines as text.
    const parsedBy = new Map(unparsed.map((i, n) => [i, results[n]]));

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
          ...(i.referencedRecipe ? { linked: true as const } : {}),
        };
      }
      const p = parsedBy.get(i);
      if (!p) {
        const confidence = reviewed ? null : 0;
        return {
          ...base,
          quantity: null,
          unit: null,
          food: null,
          note: base.original,
          confidence,
          asText: true,
        };
      }
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
    const unreadableNutrition: Partial<Record<MacroKey, string>> = {};
    for (const macro of MACRO_KEYS) {
      const text = recipe.nutrition?.[NUTRITION_FIELDS[macro]]?.trim();
      if (text && perServing[macro] === undefined) {
        unreadableNutrition[macro] = text;
      }
    }
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
      unreadableNutrition,
      lines,
    };
  });
}

const keyOf = (name: string) => name.trim().toLowerCase();

const CONCURRENCY = 4;

/** Resolves each distinct name once, a few at a time; keyed by trimmed lowercase. */
async function resolveAll(
  names: (string | null | undefined)[],
  resolve: (name: string) => Promise<{ id: string; name: string }>
) {
  const distinct = new Map<string, string>();
  for (const name of names) {
    if (name?.trim() && !distinct.has(keyOf(name))) {
      distinct.set(keyOf(name), name.trim());
    }
  }
  const pending = [...distinct];
  const resolved = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    await Promise.all(
      pending.slice(i, i + CONCURRENCY).map(async ([key, name]) => {
        resolved.set(key, await resolve(name));
      })
    );
  }
  return resolved;
}

type Named = { id?: string | null; name: string } | null | undefined;

/** Mealie's own food or unit, when the line still names it. */
const keptRef = (existing: Named, name: string | null) =>
  existing?.id && name?.trim() && keyOf(existing.name) === keyOf(name)
    ? { id: existing.id, name: existing.name }
    : null;

/**
 * Writes the reviewed recipe back to Mealie in one PATCH, creating the foods
 * and units the lines name that Mealie doesn't have yet. A PATCH replaces the
 * whole ingredient list, so each line that came from Mealie gets its hidden
 * fields (id, original text, linked recipe, substitutions) copied from the
 * stored ingredient, found by the line's reference id.
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

    const stored = new Map(
      (recipe.recipeIngredient ?? [])
        .filter((i) => i.referenceId)
        .map((i) => [i.referenceId!, i])
    );
    // Each stored ingredient matches at most one submitted line, so a
    // repeated reference id can't duplicate its hidden fields.
    const claimed = new Set<RawIngredient>();
    const matches = input.lines.map((l) => {
      const old = l.referenceId ? stored.get(l.referenceId) : undefined;
      if (!old || claimed.has(old)) {
        return undefined;
      }
      claimed.add(old);
      return old;
    });
    const isText = (l: ReviewInput["lines"][number]) =>
      l.asText || !l.food?.trim();

    const foodLines = input.lines
      .map((line, i) => ({ line, old: matches[i] }))
      .filter((x) => !isText(x.line) && !x.old?.referencedRecipe);
    const [foods, units] = [
      await resolveAll(
        foodLines.map((x) =>
          keptRef(x.old?.food, x.line.food) ? null : x.line.food
        ),
        d.findOrCreateFood
      ),
      await resolveAll(
        foodLines.map((x) =>
          keptRef(x.old?.unit, x.line.unit) ? null : x.line.unit
        ),
        d.findOrCreateUnit
      ),
    ];

    const recipeIngredient = input.lines.map((l, index): Ingredient => {
      const old = matches[index];
      // A linked recipe is edited in Mealie: it goes back exactly as stored.
      // (The stored object is Mealie's full ingredient, wider than RawIngredient.)
      if (old?.referencedRecipe) {
        return old as Ingredient;
      }
      const carried = old
        ? {
            referenceId: old.referenceId!,
            // Lines Mealie had unparsed keep the text the page showed, so
            // they look the same on the next load.
            originalText: isParsed(old)
              ? (old.originalText ?? null)
              : old.originalText || originalOf(old),
            ...(old.substitutions?.length
              ? {
                  substitutions:
                    old.substitutions as Ingredient["substitutions"],
                }
              : {}),
          }
        : {};
      if (isText(l)) {
        return { title: l.title, quantity: 0, note: l.note, ...carried };
      }
      const unit =
        keptRef(old?.unit, l.unit) ??
        (l.unit?.trim() ? units.get(keyOf(l.unit)) : undefined);
      const food = keptRef(old?.food, l.food) ?? foods.get(keyOf(l.food!))!;
      return {
        title: l.title,
        quantity: l.quantity ?? 0,
        unit: unit ? { id: unit.id, name: unit.name } : null,
        food: { id: food.id, name: food.name },
        note: l.note,
        ...carried,
      };
    });

    // Text Mealie holds but we can't read as a number ("10-12") shows as an
    // empty field; saving that field unchanged must not wipe it.
    const shown = normaliseNutrition(recipe.nutrition).perServing;
    const nutrition: Record<string, string | null> = {
      ...recipe.nutrition,
    };
    for (const macro of MACRO_KEYS) {
      const field = NUTRITION_FIELDS[macro];
      const value = input.nutrition[macro];
      nutrition[field] =
        value === (shown[macro] ?? null)
          ? (recipe.nutrition?.[field] ?? null)
          : value === null
            ? null
            : String(value);
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

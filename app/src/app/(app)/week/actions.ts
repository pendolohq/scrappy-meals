"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { userAction } from "@/server/action";
import { getDb } from "@/server/db/client";
import { ADHERENCE_STATUSES } from "@/server/domain/adherence";
import { parseBarcode } from "@/server/domain/barcode";
import { recipeSlug } from "@/server/domain/recipe-slug";
import { MAX_SNACK_SLOTS, SLOT_TYPES } from "@/server/domain/slots";
import { addDays, isIsoDate, weekStartSchema } from "@/server/domain/week";
import { contributeProduct } from "@/server/off-contribute";
import {
  addCheckedMeal,
  addMeal,
  checkNewMeal,
  copyWeek,
  mealDate,
  moveMeal,
  PlanError,
  removeMeal,
  removeMeals,
  setAdherence,
  setBaseServings,
  setFasting,
  setPortion,
} from "@/server/plan";
import {
  loadKnownProduct,
  lookupProduct,
  attachProductPhoto,
  saveProduct,
} from "@/server/products";
import { viewerToday } from "@/server/today";

const date = z.string().refine(isIsoDate, "invalid date");
const id = z.uuid();
const slot = z.enum(SLOT_TYPES);
const snackIndex = z
  .int()
  .min(0)
  .max(MAX_SNACK_SLOTS - 1)
  .default(0);
// At least 0.01: the column keeps two decimals, and 0 isn't allowed.
const baseServings = z.number().min(0.01).max(100);

/**
 * Refreshes the week pages and the pages under them (a meal's recipe page,
 * shopping); returns the empty success result. `"layout"` only reaches nested
 * pages with the route pattern, not a literal path, so this covers every week:
 * they are all rendered per request anyway. The Planner shows the same meals.
 */
function refreshWeek(day: string | null) {
  if (day) {
    revalidatePath("/week/[weekStart]", "layout");
    revalidatePath("/plan/[weekStart]", "page");
  }
  return {};
}

export const addMealAction = userAction(
  z.object({
    date,
    slot,
    snackIndex,
    slug: recipeSlug,
    baseServings: baseServings.optional(),
    /** A product eaten already, off-plan: see `addMeal`. */
    alreadyHad: z.boolean().optional(),
  }),
  async ({ alreadyHad, ...data }, user) => {
    await addMeal(getDb(), {
      ...data,
      unplanned: alreadyHad,
      today: await viewerToday(),
      createdBy: user.id,
    });
    return refreshWeek(data.date);
  }
);

export const lookupProductAction = userAction(
  z.object({ barcode: z.string().max(32) }),
  ({ barcode }) => lookupProduct(barcode)
);

/** A product already in Mealie, picked by slug from search or recent products. */
export const loadProductAction = userAction(
  z.object({ slug: recipeSlug }),
  ({ slug }) => loadKnownProduct(slug)
);

const macroAmount = (max: number) => z.number().min(0).max(max).optional();

/** Saves a checked product in Mealie and adds it to the day in one go. */
export const saveProductAction = userAction(
  z.object({
    barcode: z.string().max(32),
    name: z.string().trim().min(1).max(120),
    servingGrams: z.number().min(0.1).max(5000),
    servingUnit: z.enum(["g", "ml"]),
    packGrams: z.number().min(0.1).max(100000).nullable(),
    per100: z.object({
      kcal: macroAmount(1000),
      protein: macroAmount(100),
      carbs: macroAmount(100),
      fat: macroAmount(100),
      fibre: macroAmount(100),
    }),
    fromOpenFoodFacts: z.boolean(),
    edited: z.boolean(),
    // Checked against Open Food Facts' hosts by `saveProduct`.
    imageUrl: z.string().max(500).nullable(),
    date,
    slot,
    snackIndex,
    baseServings,
    alreadyHad: z.boolean(),
    /** Also send the product to Open Food Facts (when the app is set up to). */
    contribute: z.boolean().default(false),
    /** The serving and pack size are from the pack or typed, not guessed. */
    servingKnown: z.boolean().default(false),
    packKnown: z.boolean().default(false),
  }),
  async (
    {
      date,
      slot,
      snackIndex,
      baseServings,
      alreadyHad,
      contribute,
      servingKnown,
      packKnown,
      ...product
    },
    user
  ) => {
    const today = await viewerToday();
    const meal = {
      date,
      slot,
      snackIndex,
      baseServings,
      unplanned: alreadyHad,
      today,
    };
    // Before anything is created in Mealie.
    await checkNewMeal(getDb(), meal);
    const { slug, photoUrl } = await saveProduct(product);
    // Before the meal is added: if that fails, the retry finds the product
    // already in Mealie and has no photo to attach.
    if (photoUrl) {
      after(() => attachProductPhoto(slug, photoUrl));
    }
    await addCheckedMeal(getDb(), { ...meal, slug, createdBy: user.id });
    const barcode = parseBarcode(product.barcode);
    if (contribute && barcode) {
      // After the response: a slow or failing Open Food Facts must not delay
      // or fail a save that already happened. The outcome is kept in the
      // product's off_contributions row.
      after(async () => {
        try {
          await contributeProduct(
            getDb(),
            {
              barcode,
              name: product.name,
              servingGrams: servingKnown ? product.servingGrams : null,
              servingUnit: product.servingUnit,
              packGrams: packKnown ? product.packGrams : null,
              per100: product.per100,
            },
            user.id
          );
        } catch (err) {
          console.error("Open Food Facts contribution failed", err);
        }
      });
    }
    refreshWeek(date);
    return { slug };
  }
);

// The plan is shared: either person can set anyone's portion.
export const setPortionAction = userAction(
  z.object({ mealId: id, userId: id, multiplier: z.number().min(0).max(20) }),
  async (data) => {
    await setPortion(getDb(), data.mealId, data.userId, data.multiplier);
    return refreshWeek(await mealDate(getDb(), data.mealId));
  }
);

export const setServingsAction = userAction(
  z.object({ mealId: id, baseServings }),
  async (data) => {
    await setBaseServings(getDb(), data.mealId, data.baseServings);
    return refreshWeek(await mealDate(getDb(), data.mealId));
  }
);

export const removeMealAction = userAction(
  z.object({ mealId: id }),
  async ({ mealId }) => {
    const day = await mealDate(getDb(), mealId);
    await removeMeal(getDb(), mealId);
    return refreshWeek(day);
  }
);

export const moveMealAction = userAction(
  z.object({ mealId: id, date, slot, snackIndex }),
  async ({ mealId, ...to }) => {
    await moveMeal(getDb(), mealId, { ...to, today: await viewerToday() });
    return refreshWeek(to.date);
  }
);

/** Copies last week's meals into the empty slots of `weekStart`. */
export const copyLastWeekAction = userAction(
  z.object({ weekStart: weekStartSchema }),
  async ({ weekStart }, user) => {
    const result = await copyWeek(
      getDb(),
      addDays(weekStart, -7),
      weekStart,
      user.id
    );
    refreshWeek(weekStart);
    return result;
  }
);

// A week holds a few dozen meals at most; the cap only bounds the input.
export const undoCopyAction = userAction(
  z.object({ mealIds: z.array(id).min(1).max(500) }),
  async ({ mealIds }) => {
    const day = await mealDate(getDb(), mealIds[0]);
    await removeMeals(getDb(), mealIds);
    return refreshWeek(day);
  }
);

/** Each person sets only their own fasting days. */
export const setFastingAction = userAction(
  z.object({ date, fasting: z.boolean() }),
  async (data, user) => {
    await setFasting(getDb(), user.id, data.date, data.fasting);
    return refreshWeek(data.date);
  }
);

/** Each person logs only their own meals, and only from the day itself onwards. */
export const setAdherenceAction = userAction(
  z.object({
    mealId: id,
    status: z.enum(ADHERENCE_STATUSES).nullable(),
    note: z.string().max(2000).nullish(),
  }),
  async (data, user) => {
    const day = await mealDate(getDb(), data.mealId);
    if (!day) {
      throw new PlanError("That meal no longer exists");
    }
    if (day > (await viewerToday())) {
      throw new PlanError("You can log this once the day comes");
    }
    await setAdherence(getDb(), data.mealId, user.id, data.status, data.note);
    return refreshWeek(day);
  }
);

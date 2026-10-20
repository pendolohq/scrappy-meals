import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type { ImportState } from "../mealie/import-state";
import type { RecipeNutrition } from "../mealie/nutrition";
import type { Ingredient, RecipeNote, RecipeStep } from "../mealie/recipes";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const mealSlotType = pgEnum("meal_slot_type", [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
]);
export const adherenceStatus = pgEnum("adherence_status", [
  "stuck",
  "partial",
  "skipped",
  "swapped",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Stored lowercased; see normaliseEmail(). */
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    /** Bumped on password change; sessions carrying an older value are rejected (and a removed user's row is gone). */
    sessionVersion: integer("session_version").notNull().default(0),
    targetKcal: integer("target_kcal"),
    targetProteinG: numeric("target_protein_g", {
      precision: 6,
      scale: 1,
      mode: "number",
    }),
    targetCarbsG: numeric("target_carbs_g", {
      precision: 6,
      scale: 1,
      mode: "number",
    }),
    targetFatG: numeric("target_fat_g", {
      precision: 6,
      scale: 1,
      mode: "number",
    }),
    targetFibreG: numeric("target_fibre_g", {
      precision: 6,
      scale: 1,
      mode: "number",
    }),
    /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
    defaultFastingDays: smallint("default_fasting_days")
      .array()
      .notNull()
      .default(sql`'{}'`),
    ...timestamps,
  },
  (t) => [
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check(
      "users_fasting_days_valid",
      sql`${t.defaultFastingDays} <@ '{1,2,3,4,5,6,7}'::smallint[]`
    ),
    check(
      "users_target_kcal_positive",
      sql`${t.targetKcal} IS NULL OR ${t.targetKcal} > 0`
    ),
  ]
);

export const dayOverrides = pgTable(
  "day_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    isFasting: boolean("is_fasting").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })]
);

export const mealSlots = pgTable(
  "meal_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date", { mode: "string" }).notNull(),
    slot: mealSlotType("slot").notNull(),
    /** Orders several entries of the same slot on one day (e.g. two snacks). */
    position: smallint("position").notNull().default(0),
    mealieRecipeSlug: text("mealie_recipe_slug").notNull(),
    /** Servings one person eats at multiplier 1. */
    baseServings: numeric("base_servings", {
      precision: 5,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(1),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("meal_slots_date_slot_position").on(t.date, t.slot, t.position),
    check("meal_slots_base_servings_positive", sql`${t.baseServings} > 0`),
  ]
);

export const slotPortions = pgTable(
  "slot_portions",
  {
    mealSlotId: uuid("meal_slot_id")
      .notNull()
      .references(() => mealSlots.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 0 = not eating it. */
    multiplier: numeric("multiplier", {
      precision: 4,
      scale: 2,
      mode: "number",
    })
      .notNull()
      .default(1),
  },
  (t) => [
    primaryKey({ columns: [t.mealSlotId, t.userId] }),
    check(
      "slot_portions_multiplier_range",
      sql`${t.multiplier} >= 0 AND ${t.multiplier} <= 20`
    ),
  ]
);

export const adherence = pgTable(
  "adherence",
  {
    mealSlotId: uuid("meal_slot_id")
      .notNull()
      .references(() => mealSlots.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: adherenceStatus("status").notNull(),
    note: text("note"),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [primaryKey({ columns: [t.mealSlotId, t.userId] })]
);

/** Local copy of the Mealie recipe fields we use, so a week renders without 28 API calls. */
export const recipeCache = pgTable(
  "recipe_cache",
  {
    slug: text("slug").primaryKey(),
    mealieId: uuid("mealie_id").notNull(),
    name: text("name").notNull(),
    imagePath: text("image_path"),
    servings: numeric("servings", { precision: 6, scale: 2, mode: "number" }),
    nutrition: jsonb("nutrition").$type<RecipeNutrition>().notNull(),
    ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull(),
    // Null on rows cached before the recipe page needed them.
    instructions: jsonb("instructions").$type<RecipeStep[]>(),
    notes: jsonb("notes").$type<RecipeNote[]>(),
    sourceUrl: text("source_url"),
    // Rows cached before imports existed refresh within the hour; until then
    // they read as plain Mealie recipes.
    reviewState: text("review_state")
      .$type<ImportState["review"]>()
      .notNull()
      .default("done"),
    nutritionSource: text("nutrition_source").$type<ImportState["nutrition"]>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "recipe_cache_review_state",
      sql`${t.reviewState} in ('pending', 'done')`
    ),
    check(
      "recipe_cache_nutrition_source",
      sql`${t.nutritionSource} in ('source', 'estimated', 'reviewed')`
    ),
  ]
);

/** Items we created in Mealie per week, so a re-push replaces them instead of duplicating. */
export const shoppingPushes = pgTable("shopping_pushes", {
  weekStart: date("week_start", { mode: "string" }).primaryKey(),
  mealieListId: uuid("mealie_list_id").notNull(),
  mealieItemIds: uuid("mealie_item_ids")
    .array()
    .notNull()
    .default(sql`'{}'`),
  pushedAt: timestamp("pushed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;

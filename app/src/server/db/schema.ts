import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
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

import type { ProductInfo } from "../domain/product";
import {
  DEFAULT_SNACK_SLOTS,
  MAX_SNACK_SLOTS,
  SLOT_TYPES,
} from "../domain/slots";
import type { Organizer } from "../domain/taxonomy";
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

export const mealSlotType = pgEnum("meal_slot_type", SLOT_TYPES);
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
    /** Which snack of the day (0 = morning); always 0 for other slots. */
    snackIndex: smallint("snack_index").notNull().default(0),
    /** Orders several entries within one slot (and snack index) on one day. */
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
    /**
     * Eaten off-plan and logged afterwards: adherence leaves it out, since
     * there was no plan to stick to.
     */
    unplanned: boolean("unplanned").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("meal_slots_date_slot_snack_position").on(
      t.date,
      t.slot,
      t.snackIndex,
      t.position
    ),
    check(
      "meal_slots_snack_index_valid",
      sql`${t.snackIndex} BETWEEN 0 AND ${sql.raw(String(MAX_SNACK_SLOTS - 1))} AND (${t.slot} = 'snack' OR ${t.snackIndex} = 0)`
    ),
    check("meal_slots_base_servings_positive", sql`${t.baseServings} > 0`),
  ]
);

/** One row at most (id = 1); no row means the defaults. */
export const householdSettings = pgTable(
  "household_settings",
  {
    id: smallint("id").primaryKey().default(1),
    snackSlots: smallint("snack_slots").notNull().default(DEFAULT_SNACK_SLOTS),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    check("household_settings_single_row", sql`${t.id} = 1`),
    check(
      "household_settings_snack_slots_valid",
      sql`${t.snackSlots} BETWEEN 0 AND ${sql.raw(String(MAX_SNACK_SLOTS))}`
    ),
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
    // Null on rows cached before the recipe page showed them.
    tags: jsonb("tags").$type<Organizer[]>(),
    categories: jsonb("categories").$type<Organizer[]>(),
    totalMinutes: integer("total_minutes"),
    // Set for a packaged product; null for recipes and for rows cached
    // before the column.
    product: jsonb("product").$type<ProductInfo>(),
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

/**
 * Lines of the week's shopping list that someone ticked. The amounts are what
 * the device showed, so a plan that grows afterwards shows the line again with
 * the difference.
 */
export const shoppingTicks = pgTable(
  "shopping_ticks",
  {
    weekStart: date("week_start", { mode: "string" }).notNull(),
    lineKey: text("line_key").notNull(),
    amounts: jsonb("amounts")
      .$type<{ quantity: number; unit: string | null }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkedBy: uuid("checked_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [primaryKey({ columns: [t.weekStart, t.lineKey] })]
);

/** Plan lines someone removed from a week's list. */
export const shoppingHidden = pgTable(
  "shopping_hidden",
  {
    weekStart: date("week_start", { mode: "string" }).notNull(),
    lineKey: text("line_key").notNull(),
    amounts: jsonb("amounts")
      .$type<{ quantity: number; unit: string | null }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hiddenAt: timestamp("hidden_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    hiddenBy: uuid("hidden_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [primaryKey({ columns: [t.weekStart, t.lineKey] })]
);

/** Lines added by hand to a week's list. The id is made in the browser, so a replayed add is a no-op. */
export const shoppingExtras = pgTable(
  "shopping_extras",
  {
    id: uuid("id").primaryKey(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    text: text("text").notNull(),
    checked: boolean("checked").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("shopping_extras_week_idx").on(t.weekStart)]
);

export type User = typeof users.$inferSelect;

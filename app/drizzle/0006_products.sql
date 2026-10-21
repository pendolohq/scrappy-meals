ALTER TABLE "meal_slots" ADD COLUMN "unplanned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD COLUMN "product" jsonb;
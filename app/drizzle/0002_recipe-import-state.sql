ALTER TABLE "recipe_cache" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD COLUMN "review_state" text DEFAULT 'done' NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD COLUMN "nutrition_source" text;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD CONSTRAINT "recipe_cache_review_state" CHECK ("recipe_cache"."review_state" in ('pending', 'done'));--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD CONSTRAINT "recipe_cache_nutrition_source" CHECK ("recipe_cache"."nutrition_source" in ('source', 'estimated', 'reviewed'));
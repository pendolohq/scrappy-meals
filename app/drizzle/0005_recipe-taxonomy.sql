ALTER TABLE "recipe_cache" ADD COLUMN "tags" jsonb;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD COLUMN "categories" jsonb;--> statement-breakpoint
ALTER TABLE "recipe_cache" ADD COLUMN "total_minutes" integer;
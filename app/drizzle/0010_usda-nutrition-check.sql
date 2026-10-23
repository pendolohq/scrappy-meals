CREATE TABLE "usda_food_matches" (
	"mealie_food_id" uuid PRIMARY KEY NOT NULL,
	"food_name" text NOT NULL,
	"fdc_id" integer NOT NULL,
	"status" text NOT NULL,
	"piece_grams" numeric(8, 3),
	"piece_label" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usda_food_matches_status" CHECK ("usda_food_matches"."status" in ('suggested', 'confirmed'))
);
--> statement-breakpoint
CREATE TABLE "usda_foods" (
	"fdc_id" integer PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"data_type" text NOT NULL,
	"per_100g" jsonb NOT NULL,
	"portions" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usda_recipe_reviews" (
	"recipe_id" uuid PRIMARY KEY NOT NULL,
	"usda_per_serving" jsonb NOT NULL,
	"choice" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usda_recipe_reviews_choice" CHECK ("usda_recipe_reviews"."choice" in ('mealie', 'usda', 'edited'))
);
--> statement-breakpoint
CREATE TABLE "usda_suggest_misses" (
	"mealie_food_id" uuid PRIMARY KEY NOT NULL,
	"tried_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usda_food_matches" ADD CONSTRAINT "usda_food_matches_fdc_id_usda_foods_fdc_id_fk" FOREIGN KEY ("fdc_id") REFERENCES "public"."usda_foods"("fdc_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usda_food_matches" ADD CONSTRAINT "usda_food_matches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usda_recipe_reviews" ADD CONSTRAINT "usda_recipe_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
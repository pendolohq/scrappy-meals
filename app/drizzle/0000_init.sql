CREATE TYPE "public"."adherence_status" AS ENUM('stuck', 'partial', 'skipped', 'swapped');--> statement-breakpoint
CREATE TYPE "public"."meal_slot_type" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TABLE "adherence" (
	"meal_slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "adherence_status" NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adherence_meal_slot_id_user_id_pk" PRIMARY KEY("meal_slot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "day_overrides" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_fasting" boolean NOT NULL,
	CONSTRAINT "day_overrides_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "meal_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"slot" "meal_slot_type" NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"mealie_recipe_slug" text NOT NULL,
	"base_servings" numeric(5, 2) DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meal_slots_date_slot_position" UNIQUE("date","slot","position"),
	CONSTRAINT "meal_slots_base_servings_positive" CHECK ("meal_slots"."base_servings" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_cache" (
	"slug" text PRIMARY KEY NOT NULL,
	"mealie_id" uuid NOT NULL,
	"name" text NOT NULL,
	"image_path" text,
	"servings" numeric(6, 2),
	"nutrition" jsonb NOT NULL,
	"ingredients" jsonb NOT NULL,
	"mealie_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_pushes" (
	"week_start" date PRIMARY KEY NOT NULL,
	"mealie_list_id" uuid NOT NULL,
	"mealie_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_portions" (
	"meal_slot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"multiplier" numeric(4, 2) DEFAULT 1 NOT NULL,
	CONSTRAINT "slot_portions_meal_slot_id_user_id_pk" PRIMARY KEY("meal_slot_id","user_id"),
	CONSTRAINT "slot_portions_multiplier_range" CHECK ("slot_portions"."multiplier" >= 0 AND "slot_portions"."multiplier" <= 20)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"session_version" integer DEFAULT 0 NOT NULL,
	"target_kcal" integer,
	"target_protein_g" numeric(6, 1),
	"target_carbs_g" numeric(6, 1),
	"target_fat_g" numeric(6, 1),
	"target_fibre_g" numeric(6, 1),
	"default_fasting_days" smallint[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_fasting_days_valid" CHECK ("users"."default_fasting_days" <@ '{1,2,3,4,5,6,7}'::smallint[]),
	CONSTRAINT "users_target_kcal_positive" CHECK ("users"."target_kcal" IS NULL OR "users"."target_kcal" > 0)
);
--> statement-breakpoint
ALTER TABLE "adherence" ADD CONSTRAINT "adherence_meal_slot_id_meal_slots_id_fk" FOREIGN KEY ("meal_slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adherence" ADD CONSTRAINT "adherence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_overrides" ADD CONSTRAINT "day_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_portions" ADD CONSTRAINT "slot_portions_meal_slot_id_meal_slots_id_fk" FOREIGN KEY ("meal_slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_portions" ADD CONSTRAINT "slot_portions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meal_slots_date_idx" ON "meal_slots" USING btree ("date");
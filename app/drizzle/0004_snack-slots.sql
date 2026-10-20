CREATE TABLE "household_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"snack_slots" smallint DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_settings_single_row" CHECK ("household_settings"."id" = 1),
	CONSTRAINT "household_settings_snack_slots_valid" CHECK ("household_settings"."snack_slots" BETWEEN 0 AND 4)
);
--> statement-breakpoint
ALTER TABLE "meal_slots" DROP CONSTRAINT "meal_slots_date_slot_position";--> statement-breakpoint
ALTER TABLE "meal_slots" ADD COLUMN "snack_index" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_date_slot_snack_position" UNIQUE("date","slot","snack_index","position");--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_snack_index_valid" CHECK ("meal_slots"."snack_index" BETWEEN 0 AND 3 AND ("meal_slots"."slot" = 'snack' OR "meal_slots"."snack_index" = 0));
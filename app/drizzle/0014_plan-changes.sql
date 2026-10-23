CREATE TYPE "public"."plan_change_kind" AS ENUM('fit', 'copy', 'draft', 'chat');--> statement-breakpoint
CREATE TABLE "plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_start" date NOT NULL,
	"user_id" uuid,
	"kind" "plan_change_kind" NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_changes_week_idx" ON "plan_changes" USING btree ("week_start","created_at");
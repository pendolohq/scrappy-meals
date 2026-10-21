CREATE TABLE "off_contributions" (
	"barcode" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"fields" jsonb,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "off_contributions_status" CHECK ("off_contributions"."status" in ('pending', 'sent', 'nothing', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "off_contributions" ADD CONSTRAINT "off_contributions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
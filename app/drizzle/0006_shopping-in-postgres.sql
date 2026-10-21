CREATE TABLE "shopping_extras" (
	"id" uuid PRIMARY KEY NOT NULL,
	"week_start" date NOT NULL,
	"text" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_hidden" (
	"week_start" date NOT NULL,
	"line_key" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_by" uuid,
	CONSTRAINT "shopping_hidden_week_start_line_key_pk" PRIMARY KEY("week_start","line_key")
);
--> statement-breakpoint
CREATE TABLE "shopping_ticks" (
	"week_start" date NOT NULL,
	"line_key" text NOT NULL,
	"amounts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" uuid,
	CONSTRAINT "shopping_ticks_week_start_line_key_pk" PRIMARY KEY("week_start","line_key")
);
--> statement-breakpoint
DROP TABLE "shopping_pushes" CASCADE;--> statement-breakpoint
ALTER TABLE "shopping_extras" ADD CONSTRAINT "shopping_extras_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_hidden" ADD CONSTRAINT "shopping_hidden_hidden_by_users_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_ticks" ADD CONSTRAINT "shopping_ticks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_extras_week_idx" ON "shopping_extras" USING btree ("week_start");
CREATE TABLE "holidays" (
	"date" date PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"work_days" integer[] DEFAULT '{0,1,2,3,4}' NOT NULL,
	"shift_start" time DEFAULT '09:00' NOT NULL,
	"shift_end" time DEFAULT '18:00' NOT NULL,
	"grace_in" time DEFAULT '09:15' NOT NULL,
	"work_target_min" integer DEFAULT 420 NOT NULL,
	"half_target_min" integer DEFAULT 210 NOT NULL,
	"break_allowance_min" integer DEFAULT 60 NOT NULL,
	"half_break_allowance_min" integer DEFAULT 30 NOT NULL,
	"auto_close_hours" integer DEFAULT 10 NOT NULL,
	"webhook_url" text,
	CONSTRAINT "settings_id_check" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
-- Hand-appended: the single settings row (§11.8). Sign-in reads grace_in from PUL-302 on, so the
-- row must exist before any attendance action does. company_name is a placeholder until the
-- PUL-903 editor renames it; every other column takes its default (§10.1). Idempotent.
INSERT INTO "settings" ("id", "company_name") VALUES (1, 'My company') ON CONFLICT ("id") DO NOTHING;

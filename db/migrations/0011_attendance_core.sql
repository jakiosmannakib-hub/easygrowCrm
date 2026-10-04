CREATE TABLE "attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"work_type" "work_type" NOT NULL,
	"sign_in_at" timestamp with time zone NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"sign_out_at" timestamp with time zone,
	"sign_out_type" "signout_type",
	"early_reason" text,
	"half_selection" "half_selection",
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"net_minutes" integer,
	"auto_closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_row_per_day" UNIQUE("employee_id","date"),
	CONSTRAINT "early_needs_reason" CHECK ("attendance"."sign_out_type" <> 'early' or "attendance"."early_reason" is not null),
	CONSTRAINT "signout_after_signin" CHECK ("attendance"."sign_out_at" is null or "attendance"."sign_out_at" > "attendance"."sign_in_at")
);
--> statement-breakpoint
CREATE TABLE "attendance_breaks" (
	"id" text PRIMARY KEY NOT NULL,
	"attendance_id" text NOT NULL,
	"type" "break_type" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"minutes" integer,
	CONSTRAINT "ended_after_start" CHECK ("attendance_breaks"."ended_at" is null or "attendance_breaks"."ended_at" > "attendance_breaks"."started_at")
);
--> statement-breakpoint
CREATE TABLE "daily_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"client_id" text,
	"category" text,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"estimated_hours" numeric(6, 2),
	"actual_hours" numeric(6, 2),
	"expected_output" text,
	"status" "daily_task_status" DEFAULT 'planned' NOT NULL,
	"project_task_id" text,
	"proof_type" "proof_type",
	"proof_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eod_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"date" date NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"planned_hours" numeric(6, 2),
	"actual_hours" numeric(6, 2),
	"explanation" text,
	"blockers" text,
	"issues" text,
	"tomorrow" text,
	"remarks" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"manager_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_report_per_day" UNIQUE("employee_id","date"),
	CONSTRAINT "ack_complete" CHECK (("eod_reports"."reviewed_at" is null) = ("eod_reports"."reviewed_by" is null)),
	CONSTRAINT "no_self_ack" CHECK ("eod_reports"."reviewed_by" is null or "eod_reports"."reviewed_by" <> "eod_reports"."employee_id")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_user_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_attendance_id_attendance_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendance"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_employee_id_user_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_project_task_id_project_tasks_id_fk" FOREIGN KEY ("project_task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_employee_id_user_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "att_history_idx" ON "attendance" USING btree ("employee_id","date" desc);--> statement-breakpoint
CREATE INDEX "att_open_idx" ON "attendance" USING btree ("sign_out_at") WHERE "attendance"."sign_out_at" is null;--> statement-breakpoint
CREATE INDEX "brk_att_idx" ON "attendance_breaks" USING btree ("attendance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_break" ON "attendance_breaks" USING btree ("attendance_id") WHERE "attendance_breaks"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "dt_day_idx" ON "daily_tasks" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "dt_pt_idx" ON "daily_tasks" USING btree ("project_task_id") WHERE "daily_tasks"."project_task_id" is not null;--> statement-breakpoint
CREATE INDEX "eod_idx" ON "eod_reports" USING btree ("employee_id","date" desc);--> statement-breakpoint
CREATE INDEX "eod_unreviewed_idx" ON "eod_reports" USING btree ("reviewed_at") WHERE "eod_reports"."reviewed_at" is null;--> statement-breakpoint
-- Hand-appended: drizzle does not track triggers (same as 0002_audit_log, 0006_project_tasks).
--
-- EOD content is immutable (§11.6, §13.5.7). §11.6's column grants need an easygrowcrm_app role
-- that does not exist, so this follows the audit_log precedent instead: a trigger, which binds
-- every role including the table owner. Shipped in PUL-301, ahead of PUL-605.
--
-- UPDATE: allowed only when nothing but the four acknowledgment columns (reviewed_at,
-- reviewed_by, flagged, manager_note) changes. The comparison is the whole row minus those
-- four, so a column added later is immutable by default, the safe direction.
-- DELETE: always refused. TRUNCATE is a different event and is not blocked, which is what lets
-- test fixtures reset (as with audit_log).
CREATE OR REPLACE FUNCTION eod_reports_block_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'eod_reports is immutable: DELETE is not permitted';
  END IF;
  IF (to_jsonb(NEW) - 'reviewed_at' - 'reviewed_by' - 'flagged' - 'manager_note')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'reviewed_at' - 'reviewed_by' - 'flagged' - 'manager_note') THEN
    RAISE EXCEPTION 'eod_reports content is immutable: only reviewed_at, reviewed_by, flagged and manager_note may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- PG16 has no CREATE OR REPLACE TRIGGER, so DROP IF EXISTS first keeps the file re-runnable.
DROP TRIGGER IF EXISTS eod_reports_immutable ON eod_reports;
--> statement-breakpoint
CREATE TRIGGER eod_reports_immutable
  BEFORE UPDATE OR DELETE ON eod_reports
  FOR EACH ROW EXECUTE FUNCTION eod_reports_block_mutation();

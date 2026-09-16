CREATE TABLE "project_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"month" integer,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" text,
	"role_hint" text,
	"due_date" date,
	"status" "task_status" DEFAULT 'planned' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"estimated_hours" numeric(6, 2),
	"actual_hours" numeric(6, 2),
	"expected_output" text,
	"sop_url" text,
	"qc_required" boolean DEFAULT true NOT NULL,
	"proof_required" boolean DEFAULT false NOT NULL,
	"client_visible" boolean DEFAULT false NOT NULL,
	"depends_on" text,
	"revision_note" text,
	"quality_rating" smallint,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "no_self_dependency" CHECK ("project_tasks"."depends_on" is distinct from "project_tasks"."id"),
	CONSTRAINT "project_tasks_quality_rating_check" CHECK ("project_tasks"."quality_rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_subtasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_depends_on_project_tasks_id_fk" FOREIGN KEY ("depends_on") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_subtasks" ADD CONSTRAINT "task_subtasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pt_board_idx" ON "project_tasks" USING btree ("project_id","status") WHERE "project_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "pt_assignee_idx" ON "project_tasks" USING btree ("assignee_id","due_date") WHERE "project_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "pt_review_q_idx" ON "project_tasks" USING btree ("status") WHERE "project_tasks"."status" = 'submitted' and "project_tasks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "pt_depends_idx" ON "project_tasks" USING btree ("depends_on") WHERE "project_tasks"."depends_on" is not null;--> statement-breakpoint
CREATE INDEX "tc_task_idx" ON "task_checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tcm_task_idx" ON "task_comments" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "ts_task_idx" ON "task_subtasks" USING btree ("task_id");--> statement-breakpoint
-- Hand-appended: drizzle does not track triggers (same as 0002_audit_log, 0003_user_hardening).
--
-- Amendment E / §9.7-4, belt-and-braces: super_admin is never a task assignee. The FUNCTION
-- forbid_super_admin_assignee() already exists from migration 0003 (§11.9's 004), which
-- deliberately left the trigger unattached because project_tasks did not exist yet. This is
-- the migration 0003 pointed at — so attach only, never redefine.
--
-- PG16 has no CREATE OR REPLACE TRIGGER, so DROP IF EXISTS first keeps the file re-runnable.
-- The app-level check in the assign action (PUL-403) is the other half of the defence; this
-- trigger is the one that holds when someone writes SQL by hand.
DROP TRIGGER IF EXISTS pt_no_sa_assignee ON project_tasks;
--> statement-breakpoint
CREATE TRIGGER pt_no_sa_assignee BEFORE INSERT OR UPDATE OF assignee_id
  ON project_tasks FOR EACH ROW EXECUTE FUNCTION forbid_super_admin_assignee();

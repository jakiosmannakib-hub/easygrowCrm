CREATE TABLE "template_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"month_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_months" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"num" integer NOT NULL,
	"name" text NOT NULL,
	"start_month" smallint NOT NULL,
	"start_day" smallint NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "uq_month_num" UNIQUE("template_id","num"),
	CONSTRAINT "template_months_start_month_check" CHECK ("template_months"."start_month" between 0 and 11),
	CONSTRAINT "template_months_start_day_check" CHECK ("template_months"."start_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "template_task_subtasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"role_hint" text,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"est_hours" numeric(6, 2),
	"due_rule" jsonb NOT NULL,
	"qc_required" boolean DEFAULT true NOT NULL,
	"proof_required" boolean DEFAULT false NOT NULL,
	"client_visible" boolean DEFAULT false NOT NULL,
	"sop_url" text,
	"checklist" text[] DEFAULT '{}' NOT NULL,
	"expected_output" text,
	CONSTRAINT "due_rule_kind" CHECK ("template_tasks"."due_rule"->>'kind' in ('day', 'before_deadline', 'after'))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"roles" text[] DEFAULT '{}' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "template_categories" ADD CONSTRAINT "template_categories_month_id_template_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."template_months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_months" ADD CONSTRAINT "template_months_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_task_subtasks" ADD CONSTRAINT "template_task_subtasks_task_id_template_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."template_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_category_id_template_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."template_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tcat_month_idx" ON "template_categories" USING btree ("month_id","position");--> statement-breakpoint
CREATE INDEX "tm_template_idx" ON "template_months" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "tts_task_idx" ON "template_task_subtasks" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "tt_category_idx" ON "template_tasks" USING btree ("category_id","position");
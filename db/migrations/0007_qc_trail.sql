CREATE TABLE "task_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"task_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"submitter_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"note" text,
	"rating" smallint,
	"meta_rating" smallint,
	"meta_by" text,
	"meta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_self_review" CHECK ("task_reviews"."reviewer_id" <> "task_reviews"."submitter_id"),
	CONSTRAINT "no_self_meta_rating" CHECK ("task_reviews"."meta_by" is null or "task_reviews"."meta_by" <> "task_reviews"."reviewer_id"),
	CONSTRAINT "task_reviews_rating_check" CHECK ("task_reviews"."rating" between 1 and 5),
	CONSTRAINT "task_reviews_meta_rating_check" CHECK ("task_reviews"."meta_rating" between 1 and 5),
	CONSTRAINT "meta_fields_together" CHECK (("task_reviews"."meta_rating" is null) = ("task_reviews"."meta_by" is null))
);
--> statement-breakpoint
CREATE TABLE "task_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"summary" text NOT NULL,
	"hours" numeric(6, 2),
	"issues" text,
	"proof_type" "proof_type",
	"proof_value" text,
	"reviewer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviewer_not_submitter" CHECK ("task_submissions"."reviewer_id" is distinct from "task_submissions"."submitted_by")
);
--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_submission_id_task_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."task_submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_submitter_id_user_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_meta_by_user_id_fk" FOREIGN KEY ("meta_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_submissions" ADD CONSTRAINT "task_submissions_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rev_scorecard_idx" ON "task_reviews" USING btree ("reviewer_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "rev_task_idx" ON "task_reviews" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_review_per_submission" ON "task_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "sub_task_idx" ON "task_submissions" USING btree ("task_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "sub_reviewer_idx" ON "task_submissions" USING btree ("reviewer_id");
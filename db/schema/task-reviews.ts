import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { projectTasks } from './project-tasks';
import { proofType, reviewDecision } from './enums';

/**
 * The QC trail (§11.3.2) — §11.9's logical migration 009, drizzle file 0007.
 *
 * Each submit-for-review writes one `task_submissions` row; each manager decision writes one
 * `task_reviews` row pointing at it. A revision loop is simply several submissions on one task.
 * This replaces the prototype's `submission` object + `reviewHistory[]` array, which turned the
 * Manager QA scorecard into a JSONB scan; here it is an indexed aggregate.
 *
 * Both tables are append-only in spirit — a decision is a historical fact, so neither carries
 * `updated_at` or `deleted_at`. The one mutable region is `task_reviews`' meta-rating pair,
 * written later by the Manager QA layer (PUL-604).
 *
 * Follows `project-tasks.ts`: text PK, `timestamptz`, enums referenced from `./enums`.
 */

/**
 * One submit-for-review (§11.3.2).
 *
 * `reviewer_id` is a **routing hint, not a lock** (§9.7): it records who the work was sent to,
 * but any eligible manager may pick the item up. Nothing in the schema or the review action
 * treats it as ownership — `sub_reviewer_idx` exists to power the "Routed to me" chip
 * (§14.3.5), not to gate anything.
 *
 * The `reviewer_not_submitter` check uses `is distinct from` rather than `<>` because
 * `reviewer_id` is nullable: an unrouted submission must stay legal, and `NULL <> x` is NULL,
 * which a plain `<>` check would wave through by accident rather than by intent.
 *
 * `hours` is the employee's self-reported time on the work (§11.0's decimal-hours convention);
 * `proof_type` / `proof_value` are the §11.3 proof pair, both nullable because proof is only
 * required when the task says so (`project_tasks.proof_required`).
 */
export const taskSubmissions = pgTable(
  'task_submissions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id),
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => user.id),
    summary: text('summary').notNull(),
    hours: numeric('hours', { precision: 6, scale: 2 }),
    issues: text('issues'),
    proofType: proofType('proof_type'),
    proofValue: text('proof_value'),
    /** Routing hint (§9.7) — not a lock; any eligible manager may review. */
    reviewerId: text('reviewer_id').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Newest submission first: the revision loop reads the latest, not the first.
    index('sub_task_idx').on(table.taskId, sql`${table.createdAt} desc`),
    index('sub_reviewer_idx').on(table.reviewerId),
    check(
      'reviewer_not_submitter',
      sql`${table.reviewerId} is distinct from ${table.submittedBy}`,
    ),
  ],
);

/**
 * One manager decision on one submission (§11.3.2).
 *
 * **Two columns are denormalized on purpose** — the documented exceptions to §16.7, not
 * shortcuts to be tidied away:
 *
 * - `task_id` is reachable via `submission_id`, but the Manager QA scorecard aggregates by
 *   reviewer across tasks and the join costs more than the column (§11.3.2).
 * - `submitter_id` is copied from the submission **at write time**, deliberately. It is what
 *   makes `no_self_review` a database-level invariant: a check constraint can only see the row
 *   being written, so without the copy §9.7-1 would be enforceable in application code alone.
 *   Copying also freezes the historical fact against a later edit of the submission.
 *
 * The three checks are §9.7's hard invariants pushed into the database:
 * - `no_self_review` — nobody reviews their own work (§9.7-1).
 * - `no_self_meta_rating` — nobody meta-rates their own review (§9.7).
 * - `meta_fields_together` — the meta pair is both-or-neither, so a rating can never exist
 *   without an attributable rater. Written as `(a is null) = (b is null)` so it holds in both
 *   directions rather than only catching the one the UI happens to make easy.
 *
 * `one_review_per_submission` is a UNIQUE index, not a check: it is the concurrency guard
 * (§9.7-5, PUL-603). Two managers deciding simultaneously both pass their app-level checks;
 * the second INSERT loses at the index and fails cleanly instead of silently overwriting.
 *
 * `note` is required by the app when `decision = 'revision_requested'` (§11.3.2) — a rule the
 * schema cannot express, since it is conditional on another column's value.
 */
export const taskReviews = pgTable(
  'task_reviews',
  {
    id: text('id').primaryKey(),
    submissionId: text('submission_id')
      .notNull()
      .references(() => taskSubmissions.id),
    /** Denormalized from the submission for scorecard speed (§11.3.2). */
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id),
    reviewerId: text('reviewer_id')
      .notNull()
      .references(() => user.id),
    /** Copied from the submission at write time — this is what makes no_self_review checkable. */
    submitterId: text('submitter_id')
      .notNull()
      .references(() => user.id),
    decision: reviewDecision('decision').notNull(),
    /** App requires this when decision = 'revision_requested'. */
    note: text('note'),
    rating: smallint('rating'),
    /** Manager QA layer (PUL-604). */
    metaRating: smallint('meta_rating'),
    metaBy: text('meta_by').references(() => user.id),
    metaAt: timestamp('meta_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Newest first: the scorecard reads a reviewer's recent decisions.
    index('rev_scorecard_idx').on(table.reviewerId, sql`${table.createdAt} desc`),
    index('rev_task_idx').on(table.taskId, table.createdAt),
    // Concurrency guard: the second simultaneous reviewer fails cleanly (§9.7, PUL-603).
    uniqueIndex('one_review_per_submission').on(table.submissionId),
    check('no_self_review', sql`${table.reviewerId} <> ${table.submitterId}`),
    check(
      'no_self_meta_rating',
      sql`${table.metaBy} is null or ${table.metaBy} <> ${table.reviewerId}`,
    ),
    // §11.3.2 writes these two inline and unnamed; drizzle requires a name, so they carry the
    // name Postgres would have generated anyway — matching project_tasks.quality_rating.
    check('task_reviews_rating_check', sql`${table.rating} between 1 and 5`),
    check('task_reviews_meta_rating_check', sql`${table.metaRating} between 1 and 5`),
    check(
      'meta_fields_together',
      sql`(${table.metaRating} is null) = (${table.metaBy} is null)`,
    ),
  ],
);

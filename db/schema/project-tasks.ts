import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { projects } from './projects';
import { taskPriority, taskStatus } from './enums';

/**
 * §11.9's logical migration 008 — the core task table (§11.3) and its three normalized
 * children (§11.3.1). Logical 008 is drizzle file 0006; the numbering has diverged since
 * PUL-207 split logical 007 (see `projects.ts`).
 *
 * **Naming:** §17 calls the children `project_task_subtasks` / `_checklist` / `_comments`.
 * §11 is authoritative on schema and names them `task_subtasks` / `task_checklist_items` /
 * `task_comments`; those are the names used here. §17 should be corrected.
 *
 * All four tables follow `projects.ts`: text PK, `timestamptz`, and `updated_at` written
 * explicitly from the clock port by the actions — no trigger, no `$onUpdate`.
 */

/**
 * The core task table (§11.3). Ids are `pt_…`-prefixed (§11.0).
 *
 * `assignee_id` NULL means unassigned/claimable, not "missing data". It can never point at a
 * `super_admin` (Amendment E, §9.7-4): the `pt_no_sa_assignee` trigger attached in migration
 * 0006 is the belt, the app check in the assign action is the braces. `version` is the
 * optimistic-locking counter for the simultaneous-review case (§11.0).
 *
 * Three invariants the schema deliberately does NOT express, because it cannot — they live in
 * the action layer (§11.3): circular `depends_on` chains are rejected by walking the chain on
 * write; the dependency lock refuses `submitted` while the target is not approved/completed;
 * and assignee dropdowns exclude inactive users. The `no_self_dependency` check catches only
 * the one-hop case. Note the lock is display-only — it never mutates the stored status to
 * `blocked` (§3.2.5).
 *
 * `recurring` and `billable` from the prototype are intentionally absent (Amendment D; billing
 * cut in §7).
 */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    /** Retainer month number; NULL for one-off work (§11.3). */
    month: integer('month'),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** NULL = unassigned/claimable. Never a super_admin (Amendment E). */
    assigneeId: text('assignee_id').references(() => user.id),
    /** Template role label, informational only (§11.3). */
    roleHint: text('role_hint'),
    dueDate: date('due_date'),
    status: taskStatus('status').notNull().default('planned'),
    priority: taskPriority('priority').notNull().default('medium'),
    estimatedHours: numeric('estimated_hours', { precision: 6, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 6, scale: 2 }),
    expectedOutput: text('expected_output'),
    sopUrl: text('sop_url'),
    qcRequired: boolean('qc_required').notNull().default(true),
    proofRequired: boolean('proof_required').notNull().default(false),
    clientVisible: boolean('client_visible').notNull().default(false),
    dependsOn: text('depends_on').references((): AnyPgColumn => projectTasks.id),
    /** Latest revision note — denormalized convenience; the trail lives in task_reviews. */
    revisionNote: text('revision_note'),
    qualityRating: smallint('quality_rating'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Optimistic locking (§11.0) — two managers reviewing at once, second write rejected. */
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('pt_board_idx')
      .on(table.projectId, table.status)
      .where(sql`${table.deletedAt} is null`),
    index('pt_assignee_idx')
      .on(table.assigneeId, table.dueDate)
      .where(sql`${table.deletedAt} is null`),
    // The review queue reads only submitted rows, so the index carries only those.
    index('pt_review_q_idx')
      .on(table.status)
      .where(sql`${table.status} = 'submitted' and ${table.deletedAt} is null`),
    index('pt_depends_idx')
      .on(table.dependsOn)
      .where(sql`${table.dependsOn} is not null`),
    check('no_self_dependency', sql`${table.dependsOn} is distinct from ${table.id}`),
    check('project_tasks_quality_rating_check', sql`${table.qualityRating} between 1 and 5`),
  ],
);

/**
 * Employee-owned breakdown of a task (§11.3.1).
 *
 * **Subtasks are not the checklist.** These never gate submission; `task_checklist_items` does
 * (§9.6 ⁷, §16.8). Different permissions, different behaviour — do not merge them.
 *
 * `ON DELETE CASCADE`: a subtask has no meaning without its task. Note that task deletion is
 * *soft* (`deleted_at`), so this cascade fires only on a genuine hard delete.
 */
export const taskSubtasks = pgTable(
  'task_subtasks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ts_task_idx').on(table.taskId)],
);

/**
 * The QC gate (§11.3.1). Manager-owned, unlike subtasks.
 *
 * The app refuses submit while any row for the task has `done = false` (§3.2.2), and refuses
 * writes to checklist or subtasks while the task is `submitted` (the post-submission lock).
 * Both are action-layer rules; the table just stores the items.
 *
 * No `created_by`: §11.3.1 tracks per-item authorship on subtasks but not here — the checklist
 * comes from the template or the manager who owns the gate.
 */
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('tc_task_idx').on(table.taskId)],
);

/**
 * Task discussion (§11.3.1). Comments never lock — they stay writable at every status,
 * including `submitted` (§3.2.3).
 *
 * The index is `(task_id, created_at)` because the only read is one task's thread in order.
 */
export const taskComments = pgTable(
  'task_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('tcm_task_idx').on(table.taskId, table.createdAt)],
);

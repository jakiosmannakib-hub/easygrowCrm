import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { taskPriority } from './enums';

/**
 * §11.9's **logical migration 010**: the templates hierarchy (§11.4, Amendment J, PUL-501). The
 * drizzle file number differs (see the PUL-401 numbering note in §17): read the journal, not
 * §11.9.
 *
 * The model is the strict hierarchy **Template → Month → Category → Task → Subtask**, and the
 * FK chain IS the hierarchy: a subtask cannot exist without its task, a task without its
 * category, a category without its month, a month without its template. `ON DELETE CASCADE`
 * runs down the whole chain, so deleting a month removes its categories, tasks and subtasks in
 * one statement (§14.4.5's confirm dialog says so).
 *
 * There is **no flat task list and no parallel cache** anywhere in the schema. `tplAllTasks`
 * (PUL-502) is the only flattener, and it lives in code (§16.7, CLAUDE.md "Data shape").
 *
 * Only `templates` carries `updated_at` / `deleted_at`: §11.4 gives the children neither. A
 * template is soft-deleted as a whole, while months, categories, tasks and subtasks are
 * hard-deleted by the editor's cascade. Running projects are unaffected either way, because a
 * project holds copies (§11.4 "Instantiation").
 *
 * `updated_at` has no trigger and no `$onUpdate`, the convention set by `clients` (PUL-207) and
 * followed by `projects`: the actions write it from the clock port. §11.0 describes a trigger;
 * the codebase's convention governs here as it does for every other table.
 */

/**
 * The three §11.4 `due_rule` shapes (Amendment D — `weekly` / `monthly` were REMOVED).
 *
 * - `day`: Day N from the month's start.
 * - `before_deadline`: N days before the project deadline (0 = on the deadline).
 * - `after`: the day after the referenced task's due date. `ref` is a **template_task id**,
 *   never a position: positions are per-category and identify nothing globally.
 *
 * The DB enforces only the `kind` (the `due_rule_kind` CHECK). The rest (the `ref` belongs to the
 * same template, no self-reference, no cycle) is validated by the app at template save (§11.4).
 */
export type DueRule =
  | { kind: 'day'; n: number }
  | { kind: 'before_deadline'; n: number }
  | { kind: 'after'; ref: string };

/** A reusable engagement blueprint (§11.4). Ids are app-generated text (§11.0). */
export const templates = pgTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  /** Template-level badge: 'SEO', 'Website Design', … */
  category: text('category'),
  roles: text('roles')
    .array()
    .notNull()
    .default(sql`'{}'`),
  createdBy: text('created_by')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  /** Soft delete. Running projects are unaffected: they hold copies. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * Month N of a template (§11.4, §14.4.3). `num` becomes `project_tasks.month` at clone time.
 * `start_month` is 0-based (0 = January). `start_day` is the requested day, clamped per month
 * by the app (Feb 30 → Feb 28/29), never by the database.
 */
export const templateMonths = pgTable(
  'template_months',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    num: integer('num').notNull(),
    /** 'Month 1 — January 10' */
    name: text('name').notNull(),
    startMonth: smallint('start_month').notNull(),
    startDay: smallint('start_day').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [
    unique('uq_month_num').on(table.templateId, table.num),
    // Named as Postgres would name §11.4's inline column CHECKs, so the DB matches the DDL.
    check('template_months_start_month_check', sql`${table.startMonth} between 0 and 11`),
    check('template_months_start_day_check', sql`${table.startDay} between 1 and 31`),
    index('tm_template_idx').on(table.templateId, table.position),
  ],
);

/**
 * A category inside a month (§11.4) — 'On-page SEO', 'Reporting', …. Its `name` becomes
 * `project_tasks.category` at clone time; the color map lives at the UI edge.
 */
export const templateCategories = pgTable(
  'template_categories',
  {
    id: text('id').primaryKey(),
    monthId: text('month_id')
      .notNull()
      .references(() => templateMonths.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [index('tcat_month_idx').on(table.monthId, table.position)],
);

/**
 * A task blueprint (§11.4). Cloned into `project_tasks` by Start Project (PUL-506): `title` may
 * carry `{{ClientName}}` (§3.3.3), and `checklist[]` is expanded into `task_checklist_items`.
 */
export const templateTasks = pgTable(
  'template_tasks',
  {
    id: text('id').primaryKey(),
    categoryId: text('category_id')
      .notNull()
      .references(() => templateCategories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    title: text('title').notNull(),
    roleHint: text('role_hint'),
    priority: taskPriority('priority').notNull().default('medium'),
    estHours: numeric('est_hours', { precision: 6, scale: 2 }),
    dueRule: jsonb('due_rule').$type<DueRule>().notNull(),
    qcRequired: boolean('qc_required').notNull().default(true),
    proofRequired: boolean('proof_required').notNull().default(false),
    clientVisible: boolean('client_visible').notNull().default(false),
    sopUrl: text('sop_url'),
    checklist: text('checklist')
      .array()
      .notNull()
      .default(sql`'{}'`),
    expectedOutput: text('expected_output'),
  },
  (table) => [
    check('due_rule_kind', sql`${table.dueRule}->>'kind' in ('day', 'before_deadline', 'after')`),
    index('tt_category_idx').on(table.categoryId, table.position),
  ],
);

/**
 * A subtask blueprint (§11.4). **No `done` flag:** "done" is a live-task concept, and each row
 * is cloned into `task_subtasks` with `done = false` at instantiation.
 */
export const templateTaskSubtasks = pgTable(
  'template_task_subtasks',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => templateTasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
  },
  (table) => [index('tts_task_idx').on(table.taskId, table.position)],
);

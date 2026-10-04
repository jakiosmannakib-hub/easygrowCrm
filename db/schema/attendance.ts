import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clients } from './clients';
import {
  breakType,
  dailyTaskStatus,
  halfSelection,
  proofType,
  signoutType,
  taskPriority,
  workType,
} from './enums';
import { projectTasks } from './project-tasks';

/**
 * The attendance day (§11.5, §10). Column for column that block.
 *
 * §11.9's logical migration 005, shipped as drizzle file 0011_attendance_core.sql (PUL-301).
 * The atomic sign-out (PUL-305) writes this row, its breaks, the day's `daily_tasks` and the
 * `eod_reports` row in one transaction, which is why all four ride in the same migration.
 *
 * `updated_at` carries no trigger and no `$onUpdate`, matching `clients` / `projects` (PUL-207,
 * PUL-401): the attendance actions write it from the clock port, so frozen-time tests see one
 * timeline. §11.0 describes it as trigger-maintained; the codebase convention supersedes that.
 *
 * No `deleted_at`: §11.5 gives attendance none. A day is never soft-deleted.
 */
export const attendance = pgTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => user.id),
    /** Asia/Dhaka working date. */
    date: date('date').notNull(),
    workType: workType('work_type').notNull(),
    signInAt: timestamp('sign_in_at', { withTimezone: true }).notNull(),
    /** Sign-in local time past `settings.grace_in` (§10.1). */
    late: boolean('late').notNull().default(false),
    signOutAt: timestamp('sign_out_at', { withTimezone: true }),
    /** NULL while the day is open. */
    signOutType: signoutType('sign_out_type'),
    /** Required when `sign_out_type = 'early'`: the app asks, `early_needs_reason` enforces. */
    earlyReason: text('early_reason'),
    /** Set when `sign_out_type = 'half_day'`. */
    halfSelection: halfSelection('half_selection'),
    /** Running total, maintained in the same transaction as the breaks. */
    breakMinutes: integer('break_minutes').notNull().default(0),
    /** Finalized at sign-out / auto-close; capped at shift end for `auto_closed`. */
    netMinutes: integer('net_minutes'),
    autoClosedAt: timestamp('auto_closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Kills "sign in twice".
    unique('one_row_per_day').on(table.employeeId, table.date),
    check('early_needs_reason', sql`${table.signOutType} <> 'early' or ${table.earlyReason} is not null`),
    check(
      'signout_after_signin',
      sql`${table.signOutAt} is null or ${table.signOutAt} > ${table.signInAt}`,
    ),
    index('att_history_idx').on(table.employeeId, desc(table.date)),
    // The auto-close job's scan (PUL-307).
    index('att_open_idx').on(table.signOutAt).where(sql`${table.signOutAt} is null`),
  ],
);

/**
 * Breaks within one attendance day (§11.5). `ended_at` NULL means the break is running, and the
 * `one_open_break` partial unique index makes a second running break unrepresentable: the
 * database backstop for PUL-303's app-level `CONFLICT`.
 */
export const attendanceBreaks = pgTable(
  'attendance_breaks',
  {
    id: text('id').primaryKey(),
    attendanceId: text('attendance_id')
      .notNull()
      .references(() => attendance.id, { onDelete: 'cascade' }),
    type: breakType('type').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** NULL = break currently running. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Filled on end, rounded to the nearest minute. */
    minutes: integer('minutes'),
  },
  (table) => [
    check('ended_after_start', sql`${table.endedAt} is null or ${table.endedAt} > ${table.startedAt}`),
    index('brk_att_idx').on(table.attendanceId),
    uniqueIndex('one_open_break').on(table.attendanceId).where(sql`${table.endedAt} is null`),
  ],
);

/**
 * The daily plan (§11.6): one row per planned item. `project_task_id` NULL means ad-hoc.
 * `updated_at` follows the `attendance` note above: written by the actions, no trigger.
 */
export const dailyTasks = pgTable(
  'daily_tasks',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => user.id),
    date: date('date').notNull(),
    title: text('title').notNull(),
    clientId: text('client_id').references(() => clients.id),
    category: text('category'),
    priority: taskPriority('priority').notNull().default('medium'),
    estimatedHours: numeric('estimated_hours', { precision: 6, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 6, scale: 2 }),
    expectedOutput: text('expected_output'),
    status: dailyTaskStatus('status').notNull().default('planned'),
    /** NULL = ad-hoc. */
    projectTaskId: text('project_task_id').references(() => projectTasks.id),
    proofType: proofType('proof_type'),
    proofValue: text('proof_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('dt_day_idx').on(table.employeeId, table.date),
    index('dt_pt_idx').on(table.projectTaskId).where(sql`${table.projectTaskId} is not null`),
  ],
);

/**
 * The end-of-day report (§11.6), written once by the atomic sign-out. No score (Amendment H).
 *
 * The employee's content is immutable: the `eod_reports_immutable` trigger (0011, hand-appended)
 * rejects any UPDATE that changes a column other than the four acknowledgment columns, and every
 * DELETE. It replaces §11.6's column grants (there is no `easygrowcrm_app` role), following the
 * `audit_log` precedent. No `updated_at`: the content never changes, and §11.6 gives it none.
 */
export const eodReports = pgTable(
  'eod_reports',
  {
    id: text('id').primaryKey(),
    employeeId: text('employee_id')
      .notNull()
      .references(() => user.id),
    date: date('date').notNull(),
    completed: integer('completed').notNull().default(0),
    total: integer('total').notNull().default(0),
    plannedHours: numeric('planned_hours', { precision: 6, scale: 2 }),
    actualHours: numeric('actual_hours', { precision: 6, scale: 2 }),
    /** Required by the app if any task is not done. */
    explanation: text('explanation'),
    blockers: text('blockers'),
    issues: text('issues'),
    tomorrow: text('tomorrow'),
    remarks: text('remarks'),
    // Lightweight manager acknowledgment: the only writable part after insert.
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => user.id),
    /** "Needs a conversation". */
    flagged: boolean('flagged').notNull().default(false),
    managerNote: text('manager_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('one_report_per_day').on(table.employeeId, table.date),
    check('ack_complete', sql`(${table.reviewedAt} is null) = (${table.reviewedBy} is null)`),
    check('no_self_ack', sql`${table.reviewedBy} is null or ${table.reviewedBy} <> ${table.employeeId}`),
    index('eod_idx').on(table.employeeId, desc(table.date)),
    // The manager's "to read" list.
    index('eod_unreviewed_idx').on(table.reviewedAt).where(sql`${table.reviewedAt} is null`),
  ],
);

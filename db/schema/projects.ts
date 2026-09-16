import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clients } from './clients';
import { projectStatus } from './enums';

/**
 * Client engagements (§11.2). Column-for-column the `projects` block of that section.
 *
 * **Completes §11.9's logical migration 007.** PUL-207 shipped `clients` alone in drizzle file
 * 0004; `projects` and `personal_tasks` are the remainder, landing here as PUL-401 Stage 1.
 * Logical numbers and drizzle file numbers have not matched since that split — logical 007 is
 * drizzle 0005.
 *
 * `current_month` is deliberately absent: it is derived from `start_date` in Asia/Dhaka, not
 * stored, so nobody has to increment it (§11.2). `template_id` is provenance only — a project
 * holds its own copies of the template's tasks, so it is a bare `text` column and not a foreign
 * key to a table that does not exist yet (PUL-501).
 *
 * Archiving and deletion are both soft (§11.0): `status = 'archived'` for the lifecycle, and
 * `deleted_at` for removal. Both partial indices are scoped `where deleted_at is null` because
 * every read path filters soft-deleted rows out.
 *
 * `updated_at` carries no trigger and no `$onUpdate`, matching `clients` (PUL-207): it is
 * written explicitly from the clock port by the actions, so frozen-time tests see one timeline.
 * §11.0 describes this column as trigger-maintained across the schema; PUL-207 set the
 * project's actual convention and this table follows it rather than splitting the two.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    /** 'Retainer' | 'One-off' | template category (§11.2) — free text, not an enum. */
    type: text('type').notNull(),
    status: projectStatus('status').notNull().default('active'),
    startDate: date('start_date').notNull(),
    deadline: date('deadline'),
    /** Provenance only; the project holds its own task copies (§11.2). */
    templateId: text('template_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('projects_client_idx')
      .on(table.clientId)
      .where(sql`${table.deletedAt} is null`),
    index('projects_status_idx')
      .on(table.status)
      .where(sql`${table.deletedAt} is null`),
    check(
      'deadline_after_start',
      sql`${table.deadline} is null or ${table.deadline} >= ${table.startDate}`,
    ),
  ],
);

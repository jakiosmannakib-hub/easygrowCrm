import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Agency clients (§11.2). Managed by SA + HR from Settings (§9.6 ¹⁰, §13.2); readable by all.
 *
 * Column-for-column the `clients` block of §11.2. Archiving is a soft delete — `deleted_at` is
 * set and the row stays, because projects (PUL-401) hold a NOT NULL foreign key to it and a
 * finished project must keep naming its client.
 *
 * **Split from §11.9's migration 007.** §11.9 pairs `clients` with `projects` (+
 * `personal_tasks`) in one logical migration. `projects` needs the `project_status` enum and
 * belongs to PUL-401, so this table ships alone in drizzle file 0004 (PUL-207) and PUL-401
 * adds the rest of logical 007 in its own file.
 *
 * No `$onUpdate(() => new Date())` like the Better Auth tables carry: `updated_at` is written
 * explicitly from the clock port by the client actions, so frozen-time tests see one timeline.
 */
export const clients = pgTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contact: text('contact'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

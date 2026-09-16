import { boolean, date, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { clients } from './clients';

/**
 * "My Tasks" — a manager's private scratchpad (§11.6). Column-for-column that block.
 *
 * The rest of §11.9's logical migration 007, alongside `projects` (see `projects.ts` for why
 * logical and drizzle numbering diverge).
 *
 * This is the one table whose CRUD is **exempt from the audit log** (§9.6 ¹¹) — the single
 * designed carve-out to §16.4, because these rows are private notes rather than
 * accountability-bearing work. Nothing else may follow its example without a PRD amendment.
 *
 * Deliberately thin: no `updated_at` and no `deleted_at`. A private note has no soft-delete
 * story and no optimistic-concurrency story — the owner is the only writer, and delete means
 * delete. `client_id` is nullable because most personal notes are not about a client.
 *
 * The single index matches the only read path: one owner's list, split by `done`, ordered by
 * `due_date`.
 */
export const personalTasks = pgTable(
  'personal_tasks',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    title: text('title').notNull(),
    clientId: text('client_id').references(() => clients.id),
    dueDate: date('due_date'),
    done: boolean('done').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('mt_owner_idx').on(table.ownerId, table.done, table.dueDate)],
);

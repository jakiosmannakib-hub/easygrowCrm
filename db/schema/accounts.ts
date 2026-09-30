import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { clients } from './clients';

/**
 * A client's end businesses (§11.2, Amendment M). EasyGrow is white-label: a `client` is the
 * partner agency, an `account` is one business that partner resells to (e.g. "Joe's Plumbing,
 * Austin"), and every project belongs to an account. Client › Account › Project.
 *
 * Column-for-column the `accounts` block of §11.2. Archiving is a soft delete (`deleted_at`),
 * following `clients`: projects hold a NOT NULL foreign key here, so a finished project must keep
 * naming its account.
 *
 * Shipped in drizzle file 0009 (PUL-414), which also replaced `projects.client_id` with
 * `projects.account_id` and backfilled one account per pre-existing client. Backfilled rows have
 * the id `acc_<client id>`; accounts created afterwards get `acc_<uuid>`.
 *
 * `updated_at` has no `$onUpdate`: the actions write it from the clock port, like `clients`.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    name: text('name').notNull(),
    /** The local SEO market, e.g. 'Austin, TX'. Free text. */
    location: text('location'),
    website: text('website'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('accounts_client_idx')
      .on(table.clientId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

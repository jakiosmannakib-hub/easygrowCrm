import { desc } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * Append-only accountability record (§11.8, §16.4).
 *
 * Every accountability-bearing mutation writes exactly one row here, inside the same
 * transaction as the work it records. UPDATE and DELETE are rejected at the database
 * level by the `audit_log_no_update_delete` trigger (migration 0002).
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_actor_idx').on(table.actorId, desc(table.createdAt)),
  ],
);

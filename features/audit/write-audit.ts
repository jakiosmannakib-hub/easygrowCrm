import { db } from '../../db';
import { auditLog } from '../../db/schema';

/**
 * The Drizzle transaction handle — the callback argument of `db.transaction(...)`.
 * Deriving it this way keeps `writeAudit` bound to a real transaction rather than
 * the base `db` connection.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface WriteAuditInput {
  actorId: string;
  /** Dotted event name from the §9.8 list, e.g. `project_task.approved`. */
  action: string;
  /** e.g. `project_task`. */
  resourceType: string;
  resourceId: string;
  /** jsonb snapshot before the change, when the event has one. */
  before?: unknown;
  /** jsonb snapshot after the change, when the event has one. */
  after?: unknown;
}

/**
 * Append one row to the append-only audit log (§9.8, §16.4).
 *
 * `writeAudit` is always called inside the mutation's own transaction, so the audit row
 * commits and rolls back with the work it records — if the business write commits and the
 * log write doesn't, the log is a lie. It therefore never opens a transaction of its own,
 * never swallows an error (a failed insert must roll the whole mutation back), and never
 * reads the clock: `created_at` is a database default.
 */
export async function writeAudit(tx: Tx, input: WriteAuditInput): Promise<void> {
  // Belt-and-suspenders: the type already demands a tx, but a bad cast would slip past it.
  if (!tx) throw new Error('writeAudit must be called inside a transaction');

  await tx.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    before: input.before ?? null,
    after: input.after ?? null,
  });
}

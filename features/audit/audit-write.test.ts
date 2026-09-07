// features/audit/audit-write.test.ts
//
// §15.4 mandatory test — "writeAudit(tx) inside transaction; rollback on tx failure".
//
// Runs against the REAL easygrowcrm_test database, no mocks (§15.7). The rollback case
// is the one that matters: §9.8 requires the audit row to share the mutation's
// transaction, so a mutation that fails must leave no trace in the log.

import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { writeAudit } from './write-audit';

const ACTOR_ID = 'usr_audit_write';

function rowsFor(resourceId: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.resourceType, 'test'), eq(auditLog.resourceId, resourceId)));
}

beforeEach(async () => {
  // audit_log.actor_id has an FK to "user", so the actor must really exist.
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified, role, active)
    values (${ACTOR_ID}, 'Audit Writer', 'audit-writer@example.com', true, 'employee', true)
  `);
});

afterEach(async () => {
  // The append-only trigger blocks DELETE on audit_log, but not TRUNCATE (it is a
  // FOR EACH ROW trigger on UPDATE/DELETE only). Truncate first — the user row is
  // referenced by any audit rows written above.
  await db.execute(sql`truncate audit_log`);
  await db.execute(sql`delete from "user" where id = ${ACTOR_ID}`);
});

describe('writeAudit (§9.8, §16.4)', () => {
  it('writes one row inside the transaction', async () => {
    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actorId: ACTOR_ID,
        action: 'test.action',
        resourceType: 'test',
        resourceId: 'r1',
        after: { x: 1 },
      });
    });

    const rows = await rowsFor('r1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: ACTOR_ID,
      action: 'test.action',
      resourceType: 'test',
      resourceId: 'r1',
      before: null,
      after: { x: 1 },
    });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('rolls the audit row back when the transaction fails', async () => {
    await expect(
      db.transaction(async (tx) => {
        await writeAudit(tx, {
          actorId: ACTOR_ID,
          action: 'test.action',
          resourceType: 'test',
          resourceId: 'r2',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // The business write failed, so the log entry must have vanished with it.
    expect(await rowsFor('r2')).toHaveLength(0);
  });
});

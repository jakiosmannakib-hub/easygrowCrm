// features/audit/audit-immutability.test.ts
//
// §15.4 mandatory test — "UPDATE/DELETE on audit_log throws (DB enforcement proof)".
//
// Runs against the REAL easygrowcrm_test database, no mocks (§15.7). Append-only is
// enforced by the `audit_log_no_update_delete` trigger from migration 0002, which
// rejects both statements for every role — the owner connection used here included.

import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { auditLog } from '../../db/schema';
import { writeAudit } from './write-audit';

const ACTOR_ID = 'usr_audit_immutable';
const RESOURCE_ID = 'r_immutable';

/**
 * Drizzle wraps a driver failure in its own "Failed query" error and keeps the Postgres
 * error as `cause`, so the trigger's message has to be read from there.
 */
async function expectAppendOnlyRejection(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, 'statement was expected to be rejected').toBeInstanceOf(Error);
  const cause = (caught as Error).cause;
  expect(String((cause as Error | undefined)?.message ?? '')).toMatch(
    /audit_log is append-only/,
  );
}

beforeEach(async () => {
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified, role, active)
    values (${ACTOR_ID}, 'Audit Reader', 'audit-reader@example.com', true, 'employee', true)
  `);
  await db.transaction(async (tx) => {
    await writeAudit(tx, {
      actorId: ACTOR_ID,
      action: 'test.recorded',
      resourceType: 'test',
      resourceId: RESOURCE_ID,
      after: { original: true },
    });
  });
});

afterEach(async () => {
  await db.execute(sql`truncate audit_log`);
  await db.execute(sql`delete from "user" where id = ${ACTOR_ID}`);
});

describe('audit_log is append-only (§9.7, §16.4)', () => {
  it('rejects UPDATE', async () => {
    await expectAppendOnlyRejection(() =>
      db.execute(sql`update audit_log set action = 'tampered' where resource_id = ${RESOURCE_ID}`),
    );
  });

  it('rejects DELETE', async () => {
    await expectAppendOnlyRejection(() =>
      db.execute(sql`delete from audit_log where resource_id = ${RESOURCE_ID}`),
    );
  });

  it('leaves the row present and unchanged after both attempts', async () => {
    await expectAppendOnlyRejection(() =>
      db.execute(sql`update audit_log set action = 'tampered' where resource_id = ${RESOURCE_ID}`),
    );
    await expectAppendOnlyRejection(() =>
      db.execute(sql`delete from audit_log where resource_id = ${RESOURCE_ID}`),
    );

    const rows = await db.select().from(auditLog).where(eq(auditLog.resourceId, RESOURCE_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'test.recorded', after: { original: true } });
  });
});

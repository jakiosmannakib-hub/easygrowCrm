// tests/seed.test.ts — PUL-109
//
// Not a §15.4 mandatory test, but the guard it exercises is the safety-critical part: every
// other test file will call these fixtures, and the only thing keeping them off a dev database
// is `assertTestDb`.

import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { auditLog, user } from '../db/schema';
import { assertTestDb, isTestDbName, reset, seedFull, seedMinimal } from './seed';

describe('isTestDbName', () => {
  it('accepts a test database', () => {
    expect(isTestDbName('easygrowcrm_test')).toBe(true);
  });

  it('rejects the dev database', () => {
    expect(isTestDbName('easygrowcrm')).toBe(false);
  });

  it('rejects production', () => {
    expect(isTestDbName('prod')).toBe(false);
  });
});

describe('assertTestDb', () => {
  it('passes against the configured test database', () => {
    expect(() => assertTestDb()).not.toThrow();
  });

  it('throws when DATABASE_URL points somewhere that is not a test database', () => {
    const real = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/easygrowcrm';
    try {
      expect(() => assertTestDb()).toThrowError(/Refusing to seed/);
    } finally {
      process.env.DATABASE_URL = real;
    }
  });
});

describe('seedMinimal', () => {
  beforeEach(async () => {
    await reset();
  });

  it('creates exactly 6 users with the §15.5 role distribution', async () => {
    await seedMinimal();

    const rows = await db.select().from(user);
    expect(rows).toHaveLength(6);

    const byRole = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.role] = (acc[row.role] ?? 0) + 1;
      return acc;
    }, {});
    expect(byRole).toEqual({ super_admin: 1, team_leader: 1, project_manager: 1, employee: 3 });
  });

  it('returns handles carrying the real ids and roles', async () => {
    const seed = await seedMinimal();

    expect(seed.superAdmin).toMatchObject({ id: 'seed_sa', role: 'super_admin' });
    expect(seed.teamLeader).toMatchObject({ id: 'seed_tl', role: 'team_leader' });
    expect(seed.projectManager).toMatchObject({ id: 'seed_pm', role: 'project_manager' });
    expect(seed.employees.map((e) => e.id)).toEqual(['seed_e1', 'seed_e2', 'seed_e3']);
    expect(seed.employees.every((e) => e.role === 'employee')).toBe(true);
  });

  it('seeds everyone active and verified', async () => {
    await seedMinimal();

    const rows = await db.select().from(user);
    expect(rows.every((r) => r.active)).toBe(true);
    expect(rows.every((r) => r.emailVerified)).toBe(true);
  });

  it('is idempotent — a second seed does not duplicate the cast', async () => {
    await seedMinimal();
    await seedMinimal();

    const rows = await db.select().from(user);
    expect(rows).toHaveLength(6);
  });
});

describe('reset', () => {
  it('is safe to run twice in a row', async () => {
    await reset();
    await expect(reset()).resolves.toBeUndefined();

    const rows = await db.select().from(user);
    expect(rows).toHaveLength(0);
  });

  it('TRUNCATEs audit_log despite the append-only trigger', async () => {
    // The trigger is FOR EACH ROW on UPDATE OR DELETE; TRUNCATE fires neither. Proving it with
    // a real row present means a future trigger change (e.g. adding a TRUNCATE statement
    // trigger) fails here rather than in whichever suite happens to seed first.
    const seed = await seedMinimal();
    await db.insert(auditLog).values({
      actorId: seed.superAdmin.id,
      action: 'example.performed',
      resourceType: 'example',
      resourceId: 'r1',
      before: null,
      after: null,
    });
    expect(await db.select().from(auditLog)).toHaveLength(1);

    await expect(reset()).resolves.toBeUndefined();
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('leaves the audit_log trigger in place after truncating', async () => {
    // TRUNCATE must not be a back door that disarms the append-only guarantee.
    await seedMinimal();
    const [row] = await db
      .insert(auditLog)
      .values({
        actorId: 'seed_sa',
        action: 'example.performed',
        resourceType: 'example',
        resourceId: 'r2',
        before: null,
        after: null,
      })
      .returning();

    await expect(
      db.execute(sql`DELETE FROM "audit_log" WHERE id = ${row.id}`),
    ).rejects.toThrow();
  });
});

describe('seedFull', () => {
  it('returns the same handles as the minimal cast for now', async () => {
    const seed = await seedFull();

    expect(seed.superAdmin.id).toBe('seed_sa');
    expect(await db.select().from(user)).toHaveLength(6);
  });
});

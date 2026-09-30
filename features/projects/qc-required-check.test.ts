// features/projects/qc-required-check.test.ts (PUL-416.4, Amendment M)
//
// QA is mandatory: `qc_required = false` must be unrepresentable on BOTH `project_tasks` and
// `template_tasks`. The actions already refuse it (`z.literal(true)`), so this file tests the
// layer underneath them, the migration 0010 CHECK constraints, with raw inserts that bypass
// every action.
//
// Mutation proof, built in: the last describe drops each CHECK inside a transaction that is
// always rolled back, and shows the same `false` insert then SUCCEEDS. So the rejection above
// is the constraint, not an unrelated failure of the insert. Also run by hand at PUL-416:
// dropping both CHECKs on easygrowcrm_test fails the 3 refusal tests (and the 3 tests that drop
// the CHECK themselves); re-running 0010 restores them and all 8 pass.
//
// Also proves 0010 itself: its backfill turns existing `false` rows true, and running the file a
// second time is a no-op.
//
// Rig: the real easygrowcrm_test database (§15.7). No actions, no session.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db';
import { projectTasks, templateCategories, templateTasks } from '../../db/schema';
import { assertTestDb, seedFull, type FullSeed } from '../../tests/seed';

let seed: FullSeed;
let categoryId: string;

type Executor = Pick<typeof db, 'insert'>;

/** A raw project task insert: no action, no authorize(), just the table. */
function insertProjectTask(exec: Executor, id: string, qcRequired: boolean) {
  return exec.insert(projectTasks).values({
    id,
    projectId: seed.project.id,
    category: 'On-page SEO',
    title: `QC check ${id}`,
    createdBy: seed.projectManager.id,
    qcRequired,
  });
}

/** A raw template task insert under a seeded category. */
function insertTemplateTask(exec: Executor, id: string, qcRequired: boolean) {
  return exec.insert(templateTasks).values({
    id,
    categoryId,
    position: 999,
    title: `QC check ${id}`,
    dueRule: { kind: 'day', n: 1 },
    qcRequired,
  });
}

/**
 * Drizzle wraps a driver failure in its own "Failed query" error and keeps the Postgres error
 * as `cause`, the same pattern as assign.test.ts and min-two-managers.test.ts.
 */
async function expectCheckViolation(run: () => Promise<unknown>, constraint: string) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `insert was expected to violate ${constraint}`).toBeInstanceOf(Error);
  const cause = (caught as Error).cause as { code?: string; constraint?: string } | undefined;
  // 23514 = check_violation. Naming the constraint pins WHICH check refused it.
  expect(cause?.code).toBe('23514');
  expect(cause?.constraint).toBe(constraint);
}

async function constraintNames(): Promise<string[]> {
  const rows = await db.execute<{ conname: string }>(sql`
    select conname from pg_constraint
    where conname in ('project_tasks_qc_required_check', 'template_tasks_qc_required_check')
  `);
  return rows.rows.map((r) => r.conname).sort();
}

/** Sentinel thrown to roll a transaction back on purpose. */
class Rollback extends Error {}

beforeEach(async () => {
  assertTestDb();
  seed = await seedFull();
  const [category] = await db.select({ id: templateCategories.id }).from(templateCategories).limit(1);
  categoryId = category.id;
});

describe('qc_required = false is refused by the database (Amendment M)', () => {
  it('project_tasks: a raw insert with qc_required = false violates the CHECK', async () => {
    await expectCheckViolation(
      () => insertProjectTask(db, 'pt_qc_false', false),
      'project_tasks_qc_required_check',
    );
    const rows = await db.select().from(projectTasks).where(eq(projectTasks.id, 'pt_qc_false'));
    expect(rows).toHaveLength(0);
  });

  it('template_tasks: a raw insert with qc_required = false violates the CHECK', async () => {
    await expectCheckViolation(
      () => insertTemplateTask(db, 'tt_qc_false', false),
      'template_tasks_qc_required_check',
    );
    const rows = await db.select().from(templateTasks).where(eq(templateTasks.id, 'tt_qc_false'));
    expect(rows).toHaveLength(0);
  });

  it('an UPDATE to false is refused too, not only an INSERT', async () => {
    await expectCheckViolation(
      () =>
        db.update(projectTasks).set({ qcRequired: false }).where(eq(projectTasks.id, seed.tasks[0].id)),
      'project_tasks_qc_required_check',
    );
    await expectCheckViolation(
      () => db.update(templateTasks).set({ qcRequired: false }).where(eq(templateTasks.categoryId, categoryId)),
      'template_tasks_qc_required_check',
    );
  });

  it('qc_required = true (and the column default) still inserts on both tables', async () => {
    await insertProjectTask(db, 'pt_qc_true', true);
    await insertTemplateTask(db, 'tt_qc_true', true);

    const [pt] = await db.select().from(projectTasks).where(eq(projectTasks.id, 'pt_qc_true'));
    const [tt] = await db.select().from(templateTasks).where(eq(templateTasks.id, 'tt_qc_true'));
    expect(pt.qcRequired).toBe(true);
    expect(tt.qcRequired).toBe(true);
  });

  it('every seeded row is qc_required = true (the seed templates were flipped)', async () => {
    const falseRows = await db.execute<{ n: number }>(sql`
      select (select count(*) from project_tasks where not qc_required)
           + (select count(*) from template_tasks where not qc_required) as n
    `);
    expect(Number(falseRows.rows[0].n)).toBe(0);
  });
});

describe('MUTATION PROOF: the rejection is the CHECK, nothing else', () => {
  for (const table of [
    { name: 'project_tasks', constraint: 'project_tasks_qc_required_check', insert: insertProjectTask },
    { name: 'template_tasks', constraint: 'template_tasks_qc_required_check', insert: insertTemplateTask },
  ] as const) {
    it(`${table.name}: with the CHECK dropped, the same false insert succeeds`, async () => {
      let insertedWhileDropped = false;

      await expect(
        db.transaction(async (tx) => {
          await tx.execute(
            sql.raw(`alter table "${table.name}" drop constraint "${table.constraint}"`),
          );
          await table.insert(tx, `${table.name}_mutant`, false);
          insertedWhileDropped = true;
          // Never commit a schema mutation from a test.
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);

      expect(insertedWhileDropped).toBe(true);
      // Rolled back: the constraint is still there for every other test.
      expect(await constraintNames()).toContain(table.constraint);
    });
  }
});

describe('migration 0010 backfills and is re-runnable', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'db/migrations/0010_qc_required_always.sql'),
    'utf8',
  );
  const statements = migration
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  it('turns pre-existing false rows true, restores both CHECKs, and a second run is a no-op', async () => {
    await expect(
      db.transaction(async (tx) => {
        // Rewind to the pre-0010 world: no CHECKs, and one false row per table.
        await tx.execute(sql`alter table project_tasks drop constraint project_tasks_qc_required_check`);
        await tx.execute(sql`alter table template_tasks drop constraint template_tasks_qc_required_check`);
        await insertProjectTask(tx, 'pt_legacy_false', false);
        await insertTemplateTask(tx, 'tt_legacy_false', false);

        // Run the real file twice. The second run must not error (constraints already exist,
        // nothing left to backfill).
        for (let run = 0; run < 2; run++) {
          for (const statement of statements) await tx.execute(sql.raw(statement));
        }

        const counts = await tx.execute<{ pt: number; tt: number; checks: number }>(sql`
          select
            (select count(*) from project_tasks where not qc_required) as pt,
            (select count(*) from template_tasks where not qc_required) as tt,
            (select count(*) from pg_constraint where conname in
              ('project_tasks_qc_required_check', 'template_tasks_qc_required_check')) as checks
        `);
        expect(Number(counts.rows[0].pt)).toBe(0);
        expect(Number(counts.rows[0].tt)).toBe(0);
        expect(Number(counts.rows[0].checks)).toBe(2);

        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    expect(await constraintNames()).toEqual([
      'project_tasks_qc_required_check',
      'template_tasks_qc_required_check',
    ]);
  });
});

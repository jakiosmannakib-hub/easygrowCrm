// features/employees/action-result-boundary.test.ts — PUL-111
//
// §15.4 mandatory test. The guard that keeps production-only error redaction from coming back.
//
// ── WHAT THIS TEST DOES AND DOES NOT PROVE (read before trusting it) ─────────────────────
//
// It does NOT boot a production Next.js server and invoke a Server Action over HTTP. Doing
// that honestly would need `next build` + `next start`, a real signed-in cookie (the app is
// Google-OAuth-only, so there is no scriptable login), and the action's build-generated ID
// from the client manifest — brittle enough that the test would fail for reasons unrelated to
// the property under test. **That end-to-end proof is a Playwright job and is not written
// yet.** Until it exists, nothing here mechanically verifies Next's own redaction behaviour.
//
// What it DOES prove is the property that makes production work, stated directly:
//
//   1. Expected failures RESOLVE as data. If any action regresses to throwing an AppError
//      across the boundary, these tests fail — because a rejection is not a resolved result.
//      This is the actual regression guard, and it is exact.
//   2. That data survives a structured-clone boundary byte-identically, so there is nothing
//      in it for a serializer to strip: no class instance, no prototype, no non-enumerable
//      property, no `undefined`-valued key.
//   3. A thrown AppError does NOT survive that same boundary — `code` and `meta` are gone.
//      This is the bug, reproduced as an assertion rather than described in a comment.
//   4. Genuinely unexpected throws still reject, so they stay redacted.
//
// `structuredClone` is the honest stand-in, not the real thing: Next's Flight serializer is
// stricter still (it replaces a thrown error's message with a digest outright). Anything that
// fails structuredClone would certainly fail Flight; passing it is necessary, not sufficient.

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import { user as userTable } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { __resetNotifications } from '../../lib/notifications';
import { expectFail } from '../../tests/expect-result';
import { seedMinimal, type MinimalSeed } from '../../tests/seed';

const getSession = vi.fn();

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../lib/auth', () => ({ auth: { api: { getSession: () => getSession() } } }));

const { changeRole, createEmployee, deactivateEmployee, reactivateEmployee } = await import(
  './actions'
);

let seed: MinimalSeed;

function actAs(userId: string) {
  getSession.mockResolvedValue({ user: { id: userId } });
}

beforeEach(async () => {
  seed = await seedMinimal();
  __resetNotifications();
});

afterEach(() => {
  getSession.mockReset();
});

describe('why the contract exists — a thrown AppError does not survive a serialization boundary', () => {
  it('loses code and meta, keeping only the message', () => {
    const thrown = new AppError('GATE', 'This would leave fewer than two active managers', {
      reason: 'last_managers',
    });

    expect(thrown.code).toBe('GATE');
    expect(thrown.reason).toBe('last_managers');

    const crossed = structuredClone(thrown) as Partial<AppError>;

    // Everything the toast mapper switches on is gone. `errorToToast` would fall through to
    // "Something went wrong. Please try again." — which is exactly what production did for
    // every GATE, CONFLICT and FORBIDDEN before PUL-111.
    expect(crossed.code).toBeUndefined();
    expect(crossed.meta).toBeUndefined();
    expect(crossed).not.toBeInstanceOf(AppError);
  });

  it('whereas a returned ActionResult crosses unchanged', () => {
    const returned = {
      ok: false as const,
      code: 'GATE' as const,
      reason: 'last_managers',
      message: 'This would leave fewer than two active managers',
    };

    expect(structuredClone(returned)).toEqual(returned);
  });
});

describe('every action returns its failure as data (never throws it across the boundary)', () => {
  it('GATE:self_role_change resolves, and the reason survives the boundary intact', async () => {
    actAs(seed.superAdmin.id);

    // Note this is `await` then assert — NOT `rejects`. If changeRole regresses to throwing,
    // the rejection escapes and fails the test rather than being quietly accepted.
    const result = await changeRole({ userId: seed.superAdmin.id, role: 'employee' });

    const failure = expectFail(result, 'GATE', 'self_role_change');
    expect(structuredClone(failure)).toEqual(failure);
    // The specific reason is what the §14.15 r.3 toast needs; a generic code is not enough.
    expect(structuredClone(failure).reason).toBe('self_role_change');
  });

  it('GATE:last_managers resolves from the DB trigger, reason intact', async () => {
    actAs(seed.superAdmin.id);

    // 3 → 2 managers is legal; the next one crosses the §9.7-5 floor.
    await changeRole({ userId: seed.projectManager.id, role: 'employee' });

    const result = await changeRole({ userId: seed.teamLeader.id, role: 'employee' });

    const failure = expectFail(result, 'GATE', 'last_managers');
    expect(structuredClone(failure).reason).toBe('last_managers');
  });

  it('GATE:self_deactivate resolves, reason intact', async () => {
    actAs(seed.superAdmin.id);

    const result = await deactivateEmployee({
      userId: seed.superAdmin.id,
      reassignments: [],
      rerouted: [],
    });

    const failure = expectFail(result, 'GATE', 'self_deactivate');
    expect(structuredClone(failure).reason).toBe('self_deactivate');
  });

  it('FORBIDDEN from authorize() survives too — it was redacted like everything else', async () => {
    // Worth its own case: FORBIDDEN is thrown by `authorize()`, above the action body, so it
    // takes a different path out than the GATEs above. Before PUL-111 it was redacted just
    // the same, and a denied user saw the generic line instead of "You don't have permission".
    actAs(seed.employees[1].id);

    const result = await createEmployee({
      email: 'blocked@test.local',
      name: 'Blocked',
      role: 'employee',
    });

    const failure = expectFail(result, 'FORBIDDEN');
    expect(structuredClone(failure)).toEqual(failure);
    expect(structuredClone(failure).code).toBe('FORBIDDEN');
  });

  it('NOT_FOUND survives', async () => {
    actAs(seed.superAdmin.id);

    const failure = expectFail(
      await reactivateEmployee({ userId: 'usr_does_not_exist' }),
      'NOT_FOUND',
    );
    expect(structuredClone(failure)).toEqual(failure);
  });

  it('CONFLICT survives, with its refresh-worthy code intact', async () => {
    actAs(seed.superAdmin.id);

    const failure = expectFail(
      await createEmployee({
        email: seed.employees[0].email,
        name: 'Duplicate',
        role: 'employee',
      }),
      'CONFLICT',
    );
    expect(structuredClone(failure).code).toBe('CONFLICT');
  });
});

describe('unexpected throws stay throws (and therefore stay redacted)', () => {
  it('a Zod failure rejects rather than being laundered into a typed result', async () => {
    actAs(seed.superAdmin.id);

    // `actionResult` re-throws anything that is not an AppError. That is deliberate: a bug or
    // a driver failure is not one of the seven §13 outcomes, and its message and stack are
    // precisely what production redaction exists to hide. Swallowing it into `{ ok: false }`
    // would leak internals to the browser AND mislabel a crash as a handled outcome.
    await expect(reactivateEmployee({ userId: '' })).rejects.toThrow();
  });
});

describe('a success result is plain data too', () => {
  it('createEmployee returns a cloneable payload', async () => {
    actAs(seed.superAdmin.id);

    const result = await createEmployee({
      email: 'cloneable@test.local',
      name: 'Cloneable',
      role: 'employee',
    });

    expect(result.ok).toBe(true);
    // Dates are structured-cloneable; a class instance or a function would not be.
    expect(() => structuredClone(result)).not.toThrow();

    // Sanity: the row really landed, so this isn't asserting over an empty object.
    const rows = await db
      .select()
      .from(userTable)
      .where(eq(userTable.email, 'cloneable@test.local'));
    expect(rows).toHaveLength(1);
  });
});

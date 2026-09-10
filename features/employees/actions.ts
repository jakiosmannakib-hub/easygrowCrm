// features/employees/actions.ts
//
// Employee administration actions (§13.1). Built to the 5-step shape from
// features/_example/actions.ts: validate → authorize → withTx → writeAudit → notify.

'use server';

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { session as sessionTable, user as userTable } from '../../db/schema';
import { actionResult } from '../../lib/action-result';
import { authorize } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { withTx } from '../../lib/mutation';
import { notify } from '../../lib/notifications';
import { writeAudit } from '../audit/write-audit';
import { activeManagerCount, getDeactivationBlockers, MANAGER_ROLES } from './queries';
import {
  ChangeRoleInput,
  CreateEmployeeInput,
  DeactivateEmployeeInput,
  ReactivateEmployeeInput,
  UpdateEmployeeInput,
} from './schema';

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error and keeps the pg error as `cause`.
  const candidates = [error, (error as Error | undefined)?.cause];
  return candidates.some((c) => (c as { code?: string } | undefined)?.code === UNIQUE_VIOLATION);
}

/**
 * §13.1.1 `createEmployee` — SA + HR (`employee.create`).
 *
 * Provisioning *is* the invitation (§9.2): this writes the `"user"` row and nothing else.
 * No email is sent, and deliberately NO Better Auth create-user call — `guardProvisioned`
 * (lib/auth-guards.ts) rejects any email without a pre-existing row, so the OAuth path is
 * exactly what this row unlocks. The `account` row is created by Better Auth on the person's
 * first Google sign-in, which links by email, not by id.
 *
 * Deviations from §13.1.1, both deliberate:
 *   - **No company-domain guard.** §13.1.1 cites "the same check as the OAuth gate (§9.3)",
 *     but that gate was dropped in PUL-103 — lib/auth-guards.ts has no domain check to match.
 *     Provisioning is the gate.
 *   - **No leave-balance initialization.** `leave_quotas` is migration 011 (PUL-701); the
 *     on-add hook §13.1.1 describes lands in this transaction then.
 *
 * Notify: none (§13.1.1) — the person is told out of band to sign in with Google.
 */
export async function createEmployee(input: CreateEmployeeInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = CreateEmployeeInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('employee.create');

    // 3. TRANSACT
    try {
      return await withTx(async (tx) => {
        // Pre-check for the friendly CONFLICT. The unique index is still the authority —
        // a concurrent insert between this read and ours is caught by the catch below.
        const existing = await tx
          .select({ id: userTable.id })
          .from(userTable)
          .where(eq(userTable.email, parsed.email))
          .limit(1);

        if (existing[0]) {
          throw new AppError('CONFLICT', 'An employee with this email already exists');
        }

        const id = `usr_${crypto.randomUUID()}`;

        const [row] = await tx
          .insert(userTable)
          .values({
            id,
            name: parsed.name,
            email: parsed.email,
            role: parsed.role,
            title: parsed.title ?? null,
            department: parsed.department ?? null,
            joinDate: parsed.joinDate ?? null,
            active: true,
            // Google is the only identity provider and it verifies the address itself;
            // Better Auth sets this on first sign-in. Provisioning does not assert it.
            emailVerified: false,
          })
          .returning();

        // 4. AUDIT — same tx (§9.8: "employee create/update/deactivate/reactivate").
        await writeAudit(tx, {
          actorId: actor.id,
          action: 'employee.created',
          resourceType: 'employee',
          resourceId: id,
          before: null,
          after: row,
        });

        return row;
      });
    } catch (error) {
      // The race backstop: the unique index fired between the pre-check and the insert.
      // The transaction has already rolled back, so there is no partial write to undo.
      if (isUniqueViolation(error)) {
        throw new AppError('CONFLICT', 'An employee with this email already exists');
      }
      throw error;
    }
  });
}

/**
 * The only columns §13.1.2 may touch. Not `email` (immutable), not `role` (§13.1.3), not
 * `active` (§13.1.4/§13.1.5). `name` is `NOT NULL`; the other three are clearable.
 */
type EmployeeEdit = {
  name?: string;
  title?: string | null;
  department?: string | null;
  joinDate?: string | null;
};
type EditableField = keyof EmployeeEdit;

/**
 * §13.1.2 `updateEmployee` — SA + HR (`employee.update`).
 *
 * Profile fields only. `role` is not updatable here (§13.1.3 `changeRole` owns it, SA-only,
 * with the min-2-managers guard) and `email` is immutable — the parse strips both before the
 * UPDATE is built, so a payload carrying them changes nothing.
 *
 * The UPDATE and the audit row both carry the *diff*, not the submitted payload: a form that
 * posts all four fields back with one edited writes one column and audits one field. A submit
 * that changes nothing at all is a no-op — no UPDATE, no audit row. That keeps the append-only
 * log (§16.4) a record of actual changes rather than of button presses.
 *
 * A deactivated employee is still editable: §13.1.2 names no guard, and correcting a name or
 * join date after offboarding is legitimate. `active` moves only through §13.1.4/§13.1.5.
 *
 * Notify: none (§13.1.2).
 */
export async function updateEmployee(input: UpdateEmployeeInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = UpdateEmployeeInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('employee.update');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      // Read inside the tx: the diff is computed against the row we are about to write, so a
      // concurrent edit can't slip between the read and the UPDATE.
      const [current] = await tx
        .select()
        .from(userTable)
        .where(eq(userTable.id, parsed.userId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Employee not found');
      }

      // What the caller actually submitted — an absent key is "leave alone", `null` is "clear".
      const submitted: EmployeeEdit = {
        ...(parsed.name !== undefined && { name: parsed.name }),
        ...(parsed.title !== undefined && { title: parsed.title }),
        ...(parsed.department !== undefined && { department: parsed.department }),
        ...(parsed.joinDate !== undefined && { joinDate: parsed.joinDate }),
      };

      const changes: EmployeeEdit = {};
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      for (const [field, next] of Object.entries(submitted) as [EditableField, string | null][]) {
        const currentValue = current[field] ?? null;
        const nextValue = next ?? null;
        if (currentValue === nextValue) continue; // submitted, but unchanged
        before[field] = currentValue;
        after[field] = nextValue;
        Object.assign(changes, { [field]: nextValue });
      }

      // Nothing actually moved: no UPDATE, no audit row (see the doc comment above).
      if (Object.keys(changes).length === 0) {
        return current;
      }

      const [row] = await tx
        .update(userTable)
        .set(changes)
        .where(eq(userTable.id, parsed.userId))
        .returning();

      // 4. AUDIT — same tx (§9.8). before/after carry only the changed fields.
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'employee.updated',
        resourceType: 'employee',
        resourceId: parsed.userId,
        before,
        after,
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.1.2).
  });
}

/** The trigger's message, verbatim from migration 0003 (`enforce_min_two_managers`). */
const MIN_MANAGERS_MESSAGE = 'operation would leave fewer than two active manager-level users';

function isMinManagersViolation(error: unknown): boolean {
  // Drizzle wraps the driver failure in its own "Failed query" error and keeps the Postgres
  // error as `cause` — same shape the min-two-managers test reads.
  const candidates = [error, (error as Error | undefined)?.cause];
  return candidates.some((c) =>
    String((c as Error | undefined)?.message ?? '').includes(MIN_MANAGERS_MESSAGE),
  );
}

/**
 * §13.1.3 `changeRole` — SA only (`employee.change_role`). HR cannot; §9.6 denies it.
 *
 * Guards, in order:
 *   - **target ≠ actor.** An SA who demotes themselves locks the org out of every SA-only
 *     action, so it is refused outright (`GATE:self_role_change`). Another SA can do it.
 *   - **the §9.7-5 manager floor.** Demoting the second-to-last active manager-level user
 *     (super_admin | team_leader | project_manager) is refused — but NOT by a count in this
 *     function. The `user_min_managers` trigger from migration 0003 evaluates the invariant
 *     inside the same statement that writes the row, which is race-free in a way an app-side
 *     `SELECT count(*)` can never be. This action only translates the trigger's exception
 *     into `GATE:last_managers` so the UI gets a typed error instead of a driver stack.
 *
 * **Deferred — Amendment E** (§13.1.3: promoting to `super_admin` requires the target to hold
 * no open task assignments, else `GATE:sa_has_assignments`). `project_tasks` arrives in
 * migration 008 / **PUL-401**, so no assignment can exist to violate it yet. That ticket wires
 * the check in here, alongside attaching the `pt_no_sa_assignee` trigger whose function
 * migration 0003 already defines.
 *
 * No session surgery on success: the new role takes effect on the target's next request,
 * because `getSessionUser()` re-reads `role` from the database every time (§9.5 rule 4).
 */
export async function changeRole(input: ChangeRoleInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ChangeRoleInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('employee.change_role');

    if (parsed.userId === actor.id) {
      throw new AppError('GATE', 'You cannot change your own role', {
        reason: 'self_role_change',
      });
    }

    // 3. TRANSACT
    const result = await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: userTable.id, role: userTable.role })
        .from(userTable)
        .where(eq(userTable.id, parsed.userId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Employee not found');
      }

      let row;
      try {
        [row] = await tx
          .update(userTable)
          .set({ role: parsed.role })
          .where(eq(userTable.id, parsed.userId))
          .returning();
      } catch (error) {
        // The §9.7-5 floor, enforced by the trigger inside this very statement.
        if (isMinManagersViolation(error)) {
          throw new AppError('GATE', 'This change would leave fewer than two active managers', {
            reason: 'last_managers',
          });
        }
        throw error;
      }

      // 4. AUDIT — same tx (§9.8 `employee.role_changed`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'employee.role_changed',
        resourceType: 'employee',
        resourceId: parsed.userId,
        before: { role: current.role },
        after: { role: parsed.role },
      });

      return row;
    });

    // 5. NOTIFY — after commit, outside the transaction (§12.4 step 5).
    await notify({ to: parsed.userId, type: 'role_changed', data: { role: parsed.role } });

    return result;
  });
}

/**
 * §13.1.4 `deactivateEmployee` — SA + HR (`employee.deactivate`).
 *
 * Offboarding, not deletion: the row stays, `active` goes false, and every live session is
 * destroyed so the person is locked out *now* rather than at token expiry (§9.4). Combined
 * with `guardActive` on sign-in and the role/active re-read in `getSessionUser()` (§9.5 rule
 * 4), those three together are what makes "cannot log in" true within one request.
 *
 * Guards:
 *   - **target ≠ actor.** Deactivating yourself is always a mistake and can strand the org.
 *   - **the offboarding checklist.** Every open assignment must be reassigned or cancelled and
 *     every routed review re-pointed *before* the account closes, else the work is orphaned on
 *     a person who can no longer sign in (`GATE:unresolved_assignments` / `unresolved_reviews`).
 *   - **the §9.7-5 manager floor**, enforced by migration 0003's `user_min_managers` trigger
 *     on this very UPDATE — the same mechanism and the same translation as `changeRole`.
 *
 * **Phase-2 scope.** §13.1.4's transaction has five more steps that cannot be written against
 * tables that don't exist yet. Each is marked below with the ticket that fills it in; the
 * shape here — including the two (always empty) input arrays and the blocker check — is final,
 * so those tickets add statements inside this transaction rather than reshaping the action:
 *   - apply reassignments / cancellations, + one audit row each, + `N:task_reassigned` — PUL-401
 *   - apply reviewer reroutes, + one audit row each, + `N:review_rerouted`         — PUL-401
 *   - auto-reject the target's `pending` leave                                     — PUL-701
 *   - close today's open attendance row and any open break as `auto_closed`        — attendance phase
 *
 * Notify: **none in Phase 2.** §13.1.4's only notifications announce reassignments and
 * reroutes to their new owners — there are none to announce until PUL-401. The target is not
 * notified of their own deactivation (they are told out of band, and can't sign in to read it).
 */
export async function deactivateEmployee(input: DeactivateEmployeeInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = DeactivateEmployeeInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('employee.deactivate');

    if (parsed.userId === actor.id) {
      throw new AppError('GATE', 'You cannot deactivate yourself', {
        reason: 'self_deactivate',
      });
    }

    // 3. TRANSACT — §13.1.4: every guard is checked INSIDE the tx, atomically.
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: userTable.id, active: userTable.active })
        .from(userTable)
        .where(eq(userTable.id, parsed.userId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Employee not found');
      }

      // The offboarding checklist. Vacuous until PUL-401 fills the query in — but wired now, so
      // that ticket changes one function and this gate starts biting with no edit here.
      const blockers = await getDeactivationBlockers(parsed.userId);

      if (blockers.openAssignments.length > 0) {
        throw new AppError('GATE', 'Every open task must be reassigned or cancelled first', {
          reason: 'unresolved_assignments',
          taskIds: blockers.openAssignments.map((t) => t.taskId),
        });
      }

      if (blockers.routedReviews.length > 0) {
        throw new AppError('GATE', 'Every pending review must be routed to someone else first', {
          reason: 'unresolved_reviews',
          taskIds: blockers.routedReviews.map((t) => t.taskId),
        });
      }

      let row;
      try {
        [row] = await tx
          .update(userTable)
          .set({ active: false })
          .where(eq(userTable.id, parsed.userId))
          .returning();
      } catch (error) {
        // The §9.7-5 floor, enforced by the trigger inside this very statement.
        if (isMinManagersViolation(error)) {
          throw new AppError('GATE', 'This would leave fewer than two active managers', {
            reason: 'last_managers',
          });
        }
        throw error;
      }

      // Kill every live session in the same transaction as the flag. `active: false` alone only
      // stops the *next* request through `getSessionUser()`; deleting the rows also invalidates
      // the cookie itself, so there is no window where a warm tab still works.
      await tx.delete(sessionTable).where(eq(sessionTable.userId, parsed.userId));

      // 4. AUDIT — same tx (§9.8 `employee.deactivated`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'employee.deactivated',
        resourceType: 'employee',
        resourceId: parsed.userId,
        before: { active: true },
        after: { active: false },
      });

      return row;
    });

    // 5. NOTIFY — none in Phase 2 (see the note above).
  });
}

/**
 * §13.1.5 `reactivateEmployee` — SA + HR (`employee.reactivate`).
 *
 * The inverse of §13.1.4 and deliberately far smaller than it. Offboarding has to decide the
 * fate of live work before the account closes; bringing someone back has nothing to
 * redistribute — their old assignments were reassigned or cancelled on the way out and do not
 * return. Re-granting them work is a separate, separately-audited act.
 *
 * No manager-floor concern in either direction: this can only *raise* the active manager
 * count, and `user_min_managers` only fires on a decrease. No sessions are restored — the row
 * flips and the person signs in with Google again, which is also what re-creates their
 * session legitimately rather than resurrecting cookies deleted during offboarding.
 *
 * No self-guard either, unlike deactivate: reactivating yourself is impossible by
 * construction, since a deactivated user cannot hold a session to call this with
 * (`getSessionUser()` throws DEACTIVATED first, §9.5 r.4).
 *
 * Notify: none (§13.1.5) — the person is told out of band, exactly as at provisioning.
 */
export async function reactivateEmployee(input: ReactivateEmployeeInput) {
  return actionResult(async () => {
    // 1. VALIDATE
    const parsed = ReactivateEmployeeInput.parse(input);

    // 2. AUTHORIZE — first awaited line (§9.5 rule 1).
    const actor = await authorize('employee.reactivate');

    // 3. TRANSACT
    return await withTx(async (tx) => {
      const [current] = await tx
        .select({ id: userTable.id, active: userTable.active })
        .from(userTable)
        .where(eq(userTable.id, parsed.userId))
        .limit(1);

      if (!current) {
        throw new AppError('NOT_FOUND', 'Employee not found');
      }

      // Already active: no UPDATE and no audit row — the PUL-203 convention. An audit log is a
      // record of things that *happened*, so a row claiming a change that didn't occur is worse
      // than no row: it would put a false "reactivated" event on someone's history, and two
      // admins double-clicking would manufacture two of them.
      if (current.active) {
        return current;
      }

      const [row] = await tx
        .update(userTable)
        .set({ active: true })
        .where(eq(userTable.id, parsed.userId))
        .returning();

      // 4. AUDIT — same tx (§9.8 `employee.reactivated`).
      await writeAudit(tx, {
        actorId: actor.id,
        action: 'employee.reactivated',
        resourceType: 'employee',
        resourceId: parsed.userId,
        before: { active: false },
        after: { active: true },
      });

      return row;
    });

    // 5. NOTIFY — none for this action (§13.1.5).
  });
}

/**
 * What the offboarding checklist modal needs to render, in one authorized round trip.
 *
 * This is a **read**, and it sits in actions.ts for one reason: a client component cannot call
 * `queries.ts` (server-only, no `'use server'`), and this data is fetched on demand when the
 * modal opens rather than for all ~50 people on every page load. Living here means the
 * `authorize-first` ESLint rule applies to it, which is exactly right — who is blocking whose
 * offboarding is not public information, and the same permission that gates the deactivation
 * gates knowing about it. It writes nothing and takes no transaction.
 *
 * `managerCount` / `targetIsManager` are advisory, for graying out the button with an
 * explanation. The §9.7-5 floor is enforced by the trigger inside the UPDATE and surfaces as
 * `GATE:last_managers`; see `activeManagerCount`.
 */
export async function loadOffboardingContext(input: ReactivateEmployeeInput) {
  return actionResult(async () => {
    // 1. VALIDATE — same `{ userId }` shape.
    const parsed = ReactivateEmployeeInput.parse(input);

    // 2. AUTHORIZE — first awaited line, same permission as the act it informs.
    await authorize('employee.deactivate');

    const [blockers, managerCount, target] = await Promise.all([
      getDeactivationBlockers(parsed.userId),
      activeManagerCount(),
      db
        .select({ role: userTable.role })
        .from(userTable)
        .where(eq(userTable.id, parsed.userId))
        .limit(1),
    ]);

    const role = target[0]?.role;
    if (!role) {
      throw new AppError('NOT_FOUND', 'Employee not found');
    }

    return {
      blockers,
      managerCount,
      targetIsManager: (MANAGER_ROLES as readonly string[]).includes(role),
    };
  });
}

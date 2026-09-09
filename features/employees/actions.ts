// features/employees/actions.ts
//
// Employee administration actions (§13.1). Built to the 5-step shape from
// features/_example/actions.ts: validate → authorize → withTx → writeAudit → notify.

'use server';

import { eq } from 'drizzle-orm';
import { user as userTable } from '../../db/schema';
import { authorize } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import { withTx } from '../../lib/mutation';
import { writeAudit } from '../audit/write-audit';
import { CreateEmployeeInput, UpdateEmployeeInput } from './schema';

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
}

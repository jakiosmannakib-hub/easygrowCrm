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
import { CreateEmployeeInput } from './schema';

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

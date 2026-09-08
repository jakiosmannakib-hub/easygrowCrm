// features/_example/actions.ts
//
// Reference action. Copy this file to start a new server action.
//
// The 5-step shape (validate → authorize → withTx → writeAudit → notify-after-commit) is a
// code-review rule (§12.4/§16.2) AND enforced by the `easygrowcrm/authorize-first` ESLint
// rule. notify() is a real port (PUL-107); it stays commented here only because this
// template has nothing to announce. clock stays commented until PUL-108.

'use server';

import { z } from 'zod';
import { authorize } from '../../lib/authz';
import { withTx } from '../../lib/mutation';
import { writeAudit } from '../audit/write-audit';
// import { notify } from '../../lib/notifications';   // uncomment in your copy — see step 5

const ExampleInput = z.object({ resourceId: z.string() });

export async function exampleAction(input: z.infer<typeof ExampleInput>) {
  // 1. VALIDATE — Zod, synchronous, before anything else. A bad shape never reaches the DB.
  const parsed = ExampleInput.parse(input);

  // (A resource *read* may go here — fetching the subject you need to authorize against is
  // allowed before `authorize`, because a read decides nothing. No writes above this line.)

  // 2. AUTHORIZE — the first awaited line after validation, before any write (§9.5 rule 1).
  //    Pass the fetched resource as the second argument for `self`/`assignee`/`own` cells.
  const actor = await authorize('project.update');

  // 3. TRANSACT — business writes and the audit row commit or roll back together.
  const result = await withTx(async (tx) => {
    // ...business writes (tx.insert / tx.update / tx.delete) go here...
    //
    // Optimistic-lock pattern when updating a versioned row (§11.3): bump `version` in the
    // WHERE clause and treat "no row updated" as a lost race. Add the import at the top of
    // your copy —
    //
    //   import { AppError } from '../../lib/errors';
    //
    //   const [row] = await tx.update(project)
    //     .set({ ...fields, version: sql`${project.version} + 1` })
    //     .where(and(eq(project.id, parsed.resourceId), eq(project.version, parsed.version)))
    //     .returning();
    //   if (!row) throw new AppError('CONFLICT');
    //
    // Throwing anywhere in here rolls the whole transaction back, audit row included.

    // 4. AUDIT — same tx (§9.8). Never against the global `db`.
    await writeAudit(tx, {
      actorId: actor.id,
      action: 'example.performed',
      resourceType: 'example',
      resourceId: parsed.resourceId,
      before: null,
      after: { ok: true },
    });

    return { ok: true };
  });

  // 5. NOTIFY — AFTER commit, OUTSIDE withTx. Work that rolls back must not notify anyone.
  //    `type` must be one of the §13.9 template names (the NotificationType union) —
  //    uncomment the import at the top of this file:
  //
  //    await notify({ to: actor.id, type: 'task_approved', data: { taskId: parsed.resourceId } });

  return result;
}

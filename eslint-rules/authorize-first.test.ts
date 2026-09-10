// eslint-rules/authorize-first.test.ts — PUL-105.4
//
// Proves the rule bites on the two real violations and stays quiet on the two legitimate
// shapes, including §12.4's "fetch the subject, then authorize" pattern.

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './authorize-first.mjs';

// RuleTester uses whatever describe/it it is handed; vitest globals are off in this project.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('authorize-first', rule, {
  valid: [
    // The _example shape: validate → authorize → withTx → writeAudit.
    `
      export async function exampleAction(input) {
        const parsed = ExampleInput.parse(input);
        const actor = await authorize('project.update');
        return withTx(async (tx) => {
          await writeAudit(tx, { actorId: actor.id });
          return { ok: true };
        });
      }
    `,
    // §12.4: a READ before authorize is allowed — you need the subject to authorize against.
    `
      export async function approveTask(input) {
        const parsed = Input.parse(input);
        const task = await getTaskForApproval(parsed.id);
        const actor = await authorize('project_task.approve', task);
        return withTx(async (tx) => {
          await writeAudit(tx, { actorId: actor.id });
        });
      }
    `,
    // An exported action that never mutates has nothing to police.
    `
      export async function readOnlyThing(input) {
        return await getSomething(input.id);
      }
    `,
    // PUL-111: the body now sits inside the `actionResult` boundary wrapper. The rule must
    // still see through it — calls are attributed to every enclosing async frame, so the
    // exported function is judged on what its wrapper's callback does.
    `
      export async function wrappedAction(input) {
        return actionResult(async () => {
          const parsed = Input.parse(input);
          const actor = await authorize('project.update');
          return withTx(async (tx) => {
            await writeAudit(tx, { actorId: actor.id });
          });
        });
      }
    `,
  ],

  invalid: [
    // Mutates without ever authorizing.
    {
      code: `
        export async function badAction(input) {
          const parsed = Input.parse(input);
          return withTx(async (tx) => {
            await writeAudit(tx, {});
          });
        }
      `,
      errors: [{ messageId: 'missingAuthorize' }],
    },
    // Authorizes, but only after the transaction has already run.
    {
      code: `
        export async function lateAuthorize(input) {
          const parsed = Input.parse(input);
          const result = await withTx(async (tx) => {
            await writeAudit(tx, {});
            return { ok: true };
          });
          await authorize('project.update');
          return result;
        }
      `,
      errors: [{ messageId: 'authorizeAfterTx' }],
    },
    // PUL-111 regression guard: the same violation inside the boundary wrapper must still be
    // reported. Before the `isExported` fix this produced NO error at all — the rule silently
    // stopped applying to any action written in this shape.
    {
      code: `
        export async function wrappedNoAuthorize(input) {
          return actionResult(async () => {
            return withTx(async (tx) => {
              await writeAudit(tx, {});
            });
          });
        }
      `,
      errors: [{ messageId: 'missingAuthorize' }],
    },
    // The other wrapper shape — `export const x = actionResult(async () => …)`. This is the
    // one that was a true no-op: the arrow's parent is a CallExpression, so the export walk
    // gave up and the action was never inspected.
    {
      code: `
        export const wrappedConstAction = actionResult(async (input) => {
          await withTx(async (tx) => {
            await writeAudit(tx, {});
          });
          await authorize('project.update');
        });
      `,
      errors: [{ messageId: 'authorizeAfterTx' }],
    },
    // Same violation in arrow-function form.
    {
      code: `
        export const badArrow = async (input) => {
          await withTx(async (tx) => {
            await writeAudit(tx, {});
          });
          await authorize('project.update');
        };
      `,
      errors: [{ messageId: 'authorizeAfterTx' }],
    },
  ],
});

// eslint-rules/no-direct-date.test.ts — PUL-108.2
//
// The rule itself has no path logic; scoping is the config glob. So these cases prove the
// AST half (which expressions bite), and the "valid" cases pin the deliberate narrowing:
// parsing a stored value is not reading the clock.

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-direct-date.mjs';

// RuleTester uses whatever describe/it it is handed; vitest globals are off in this project.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-direct-date', rule, {
  valid: [
    // The only sanctioned way to ask what time it is.
    `
      import { clock } from '../../lib/clock';
      export function isLate(shiftStart) {
        return clock.now() > shiftStart;
      }
    `,
    // Parsing a stored value is not "now".
    `const started = new Date(row.startedAt);`,
    // Formatting/arithmetic against a value the caller supplied.
    `const ms = someDate.getTime();`,
  ],
  invalid: [
    {
      // A feature file reading the wall clock directly.
      code: `export function isLate(shiftStart) { return new Date() > shiftStart; }`,
      errors: [{ messageId: 'directDate' }],
    },
    {
      code: `const elapsed = Date.now() - startedAt;`,
      errors: [{ messageId: 'directDate' }],
    },
    {
      // Both forms in one file are both reported.
      code: `const a = new Date(); const b = Date.now();`,
      errors: [{ messageId: 'directDate' }, { messageId: 'directDate' }],
    },
  ],
});

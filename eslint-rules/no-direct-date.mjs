/**
 * easygrowcrm/no-direct-date — PUL-108.2, §16.6.
 *
 * Time in feature code is a dependency, not an ambient fact. `new Date()` and `Date.now()`
 * make late-detection, timer unlock and auto-close untestable, so they are banned in
 * `features/**` and everything goes through `clock.now()` from `lib/clock`.
 *
 * Only the zero-argument forms are banned: `new Date(row.createdAt)` and `Date.now` used as
 * a value are parsing/formatting, not "what time is it". `lib/clock.ts` (the adapter) is
 * outside `features/**` and so is excluded by the config glob, not by logic in here — file
 * scoping is never done inside the rule.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Feature code must read the time from clock.now(), never new Date()/Date.now() (§16.6).',
    },
    schema: [],
    messages: {
      directDate:
        'Use clock.now() from lib/clock — direct Date access is banned in features/** (§16.6).',
    },
  },

  create(context) {
    return {
      // new Date()  — with no arguments; `new Date(someIso)` is parsing, not "now".
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0) {
          context.report({ node, messageId: 'directDate' });
        }
      },

      // Date.now()
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Date' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'now'
        ) {
          context.report({ node, messageId: 'directDate' });
        }
      },
    };
  },
};

export default rule;

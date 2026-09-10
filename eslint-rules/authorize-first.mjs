/**
 * easygrowcrm/authorize-first — PUL-105.3, §12.5.
 *
 * Every server action authorizes before it mutates. The rule is the mechanical half of the
 * §12.4/§16.2 mutation shape; code review is the other half.
 *
 * WHAT IT ENFORCES, and why it isn't literally "first await":
 * §12.5 phrases the rule as "authorize() must be the first awaited call after validation".
 * Read literally, that rejects §12.4's own canonical example, which awaits a resource fetch
 * (`await getTaskForApproval(...)`) before `authorize(...)` — you often cannot authorize until
 * you have loaded the subject to authorize against. A read decides nothing, so it is safe.
 * Mutating before authorizing is the actual security hole. So the enforceable rule is:
 *
 *   In an exported async function in `features/**\/actions.ts`:
 *     (a) it must call `authorize()` somewhere, and
 *     (b) that call must appear before any `withTx()` call.
 *
 * File scoping is done by the `files` glob in eslint.config.mjs, not in here.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Server actions must call authorize() before opening a transaction with withTx() (§12.5).',
    },
    schema: [],
    messages: {
      missingAuthorize:
        'Server action "{{name}}" must call authorize() — it is the security boundary of every action (§9.5 rule 1).',
      authorizeAfterTx:
        'authorize() must run before withTx() in "{{name}}" — never mutate before authorizing (§12.5).',
    },
  },

  create(context) {
    /** Functions currently being walked, innermost last. */
    const stack = [];

    /** True for a function that is (part of) a top-level `export`. */
    function isExported(node) {
      let child = node;
      let parent = node.parent;
      // Walk out through `const x = async () => {}` / `const x = async function () {}`, and
      // through a wrapping call — `export const x = actionResult(async () => {})` (PUL-111).
      //
      // That last case matters: without it, moving an action body inside the `actionResult`
      // boundary wrapper would make this rule a SILENT NO-OP for that action — the arrow's
      // parent is a CallExpression, which used to fail the export check, so the action was
      // never inspected at all. A lint rule that quietly stops firing is worse than one that
      // never existed, because CI still reports green.
      while (
        parent &&
        (parent.type === 'VariableDeclarator' ||
          parent.type === 'VariableDeclaration' ||
          (parent.type === 'CallExpression' && parent.arguments.includes(child)))
      ) {
        child = parent;
        parent = parent.parent;
      }
      if (!parent) return false;
      return (
        parent.type === 'ExportNamedDeclaration' ||
        parent.type === 'ExportDefaultDeclaration' ||
        // `export { exampleAction }` — the declaration itself is top level; treat any
        // top-level async function as an action, since actions.ts holds nothing else.
        (parent.type === 'Program' && child.type !== 'VariableDeclarator')
      );
    }

    function nameOf(node) {
      if (node.id?.name) return node.id.name;
      if (node.parent?.type === 'VariableDeclarator' && node.parent.id?.name) {
        return node.parent.id.name;
      }
      return 'anonymous';
    }

    /** The called identifier's name, for `foo()` and `mod.foo()` alike. */
    function calleeName(callee) {
      if (callee.type === 'Identifier') return callee.name;
      if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
        return callee.property.name;
      }
      return null;
    }

    function enter(node) {
      if (!node.async) return;
      stack.push({ node, authorizeAt: null, withTxAt: null });
    }

    function exit(node) {
      const frame = stack.length > 0 ? stack[stack.length - 1] : null;
      if (!frame || frame.node !== node) return;
      stack.pop();

      // Only top-level exported actions are checked. A nested async helper (including the
      // callback passed to withTx) is covered by the frame of the action that contains it.
      if (!isExported(node)) return;

      // Nothing to police in an action that never mutates.
      if (frame.withTxAt === null) return;

      const data = { name: nameOf(node) };
      if (frame.authorizeAt === null) {
        context.report({ node: node.id ?? node, messageId: 'missingAuthorize', data });
      } else if (frame.authorizeAt > frame.withTxAt) {
        context.report({ node: node.id ?? node, messageId: 'authorizeAfterTx', data });
      }
    }

    return {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': exit,
      FunctionExpression: enter,
      'FunctionExpression:exit': exit,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,

      CallExpression(node) {
        if (stack.length === 0) return;
        const name = calleeName(node.callee);
        if (name !== 'authorize' && name !== 'withTx') return;

        // Attribute the call to every enclosing async function, so `withTx(async (tx) => …)`
        // and calls nested inside it still count against the exported action.
        const at = node.range[0];
        for (const frame of stack) {
          if (name === 'authorize') {
            if (frame.authorizeAt === null || at < frame.authorizeAt) frame.authorizeAt = at;
          } else if (frame.withTxAt === null || at < frame.withTxAt) {
            frame.withTxAt = at;
          }
        }
      },
    };
  },
};

export default rule;

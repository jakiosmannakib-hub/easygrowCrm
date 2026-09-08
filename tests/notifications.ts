// tests/notifications.ts — PUL-107.3
//
// The assertion helper integration tests use to prove an action notified the right person.
// Reads the stub port's in-memory log; pair it with `__resetNotifications()` in setup.

import { __sentNotifications, type NotificationType, type NotifyInput } from '../lib/notifications';

export type NotificationMatcher =
  | { type?: NotificationType; data?: Record<string, unknown> }
  | ((n: NotifyInput) => boolean);

function describeSent(): string {
  const all = __sentNotifications();
  if (all.length === 0) return '  (nothing was sent)';
  return all
    .map((n) => `  → ${n.to}  ${n.type}  ${JSON.stringify(n.data ?? {})}`)
    .join('\n');
}

/**
 * Assert that at least one notification was sent to `to` matching `matcher`.
 *
 * An object matcher is a shallow match: `type` must be equal when given, and every key in
 * `data` must be present with an equal value (a subset match — extra payload keys are fine).
 * A function matcher is used as a predicate. Throws listing everything that *was* sent.
 */
export function expectNotified(to: string, matcher: NotificationMatcher): void {
  const candidates = __sentNotifications().filter((n) => n.to === to);

  const matches = candidates.filter((n) => {
    if (typeof matcher === 'function') return matcher(n);
    if (matcher.type !== undefined && n.type !== matcher.type) return false;
    if (matcher.data !== undefined) {
      const data = n.data ?? {};
      for (const [key, value] of Object.entries(matcher.data)) {
        if (!Object.is(data[key], value)) return false;
      }
    }
    return true;
  });

  if (matches.length > 0) return;

  const want =
    typeof matcher === 'function'
      ? 'a notification matching the given predicate'
      : `type=${matcher.type ?? 'any'} data⊇${JSON.stringify(matcher.data ?? {})}`;

  throw new Error(
    `expectNotified: no notification to "${to}" matched ${want}.\nSent so far:\n${describeSent()}`,
  );
}

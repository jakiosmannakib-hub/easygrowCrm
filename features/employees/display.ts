// features/employees/display.ts
//
// Presentation helpers for employee names. Pure functions, no DB — safe in both client and
// server components.

/** The suffix, defined once so the wording can't drift between call sites. */
export const DEACTIVATED_SUFFIX = ' (deactivated)';

/**
 * A user's display name, with a ` (deactivated)` suffix when they are no longer active.
 *
 * Deactivated people don't vanish from the UI — they stay on historical rows they own: an
 * audit entry's actor, a completed task's assignee, last quarter's EOD reports. Rendering a
 * bare name there implies a colleague who can still be assigned work; the suffix says the
 * account is closed without erasing the record. (Pickers don't face this problem at all —
 * `activeUsersQuery()` never offers an inactive user in the first place.)
 *
 * The caller styles the suffix muted (`text-muted-foreground`) via `displayNameParts` when it
 * can render two spans; `displayName` is the plain-string fallback for a title, an option
 * label, or anywhere only a string fits.
 */
export function displayName(user: { name: string; active: boolean }): string {
  return user.active ? user.name : `${user.name}${DEACTIVATED_SUFFIX}`;
}

/**
 * The same thing split for JSX, so the suffix can carry its own muted class:
 *
 *   const { name, suffix } = displayNameParts(user);
 *   <>{name}{suffix && <span className="text-muted-foreground">{suffix}</span>}</>
 */
export function displayNameParts(user: { name: string; active: boolean }): {
  name: string;
  suffix: string | null;
} {
  return { name: user.name, suffix: user.active ? null : DEACTIVATED_SUFFIX };
}

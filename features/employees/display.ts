// features/employees/display.ts
//
// Presentation helpers for employee names. Pure functions, no DB — safe in both client and
// server components.

import { userRole } from '../../db/schema/enums';

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

/**
 * The five `user_role` values, labelled for humans. Order follows §9.6's column order.
 *
 * Lives here rather than in a component because two surfaces now render it — the PUL-202 add
 * modal's role ▾ and the PUL-206 card grid's role badge — and a label that says "Admin / HR"
 * in one place and "HR" in the other is the kind of drift that makes a directory look
 * untrustworthy. Typed off `userRole.enumValues`, so adding a role to the enum without a
 * label here is a compile error rather than a blank badge.
 */
export const ROLE_LABELS: Record<(typeof userRole.enumValues)[number], string> = {
  super_admin: 'Super Admin',
  team_leader: 'Team Leader',
  project_manager: 'Project Manager',
  admin_hr: 'Admin / HR',
  employee: 'Employee',
};

/**
 * Up to two initials for an avatar fallback, for the (common) case of a user with no Google
 * profile image yet — an account provisioned by HR has no `image` until its owner first signs
 * in, so the fallback is the *normal* state on this page, not an edge case.
 *
 * Takes the first and last whitespace-separated parts, so "Jaki Osman Nakib" → "JN". Falls
 * back to "?" rather than "" for a name that is somehow whitespace, so the circle is never
 * mysteriously blank.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

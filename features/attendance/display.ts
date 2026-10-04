// features/attendance/display.ts
//
// Labels and pill styles for attendance surfaces (§14.2, §14.6). Client-safe: no DB.

import type { workType } from '../../db/schema/enums';

export type WorkType = (typeof workType.enumValues)[number];

/** §14.6.1's three work types, in the order the Sign-In modal offers them. */
export const WORK_TYPE_LABELS = {
  in_office: 'In-office',
  remote: 'Remote',
  client_site: 'Client site',
} as const satisfies Record<WorkType, string>;

/** Amber, quiet: Late is a fact on the record, not an alarm (§14.6.1 "no drama"). */
export const LATE_PILL_CLASSNAME =
  'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300';

/** Red, matching the Board's overdue line. */
export const OVERDUE_PILL_CLASSNAME =
  'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400';

// lib/notification-templates.ts
//
// The text of each §13.9 notification (§13 universal rule 7: text lives here, not in actions).
// Flat `lib/` per CLAUDE.md §4, so this is not `lib/notifications/templates.ts` as §13 sketches.
//
// Filled one template at a time as the actions that send them land; the rest arrive with their
// tickets and the real adapter (PUL-801), which renders `data` through these. Plain text only.

import { fmtClockTime, fmtDate } from './format';
import type { NotificationType } from './notifications';

/** `N:signed_in_late` (§13.5.1): to every active HR user when someone signs in late. */
export interface SignedInLateData {
  attendanceId: string;
  employeeId: string;
  employeeName: string;
  /** The local working day, `YYYY-MM-DD`. */
  date: string;
  /** Local sign-in time, 24-hour `HH:MM`; the text renders it 12-hour (`9:16 AM`). */
  time: string;
}

export const NOTIFICATION_TEMPLATES = {
  signed_in_late: (d: SignedInLateData) =>
    `${d.employeeName} signed in late at ${fmtClockTime(d.time)} on ${fmtDate(d.date, { relative: false })}.`,
} satisfies Partial<Record<NotificationType, (data: never) => string>>;

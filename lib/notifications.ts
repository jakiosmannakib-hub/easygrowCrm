// lib/notifications.ts
//
// The notification port (PUL-107, §13.9, §16.11).

/**
 * The §13.9 template registry — the complete set, no more and no fewer.
 *
 * A new notification means a new template in §13.9 first, then a name here. Typing the
 * registry as a union makes an invented type a compile error at the call site.
 */
export type NotificationType =
  | 'task_assigned'
  | 'task_submitted'
  | 'task_approved'
  | 'task_revision'
  | 'task_status_changed'
  | 'task_comment'
  | 'review_rerouted'
  | 'task_reassigned'
  | 'project_started'
  | 'signed_in_late'
  | 'early_signout'
  | 'auto_closed'
  | 'eod_submitted'
  | 'eod_flagged'
  | 'leave_requested'
  | 'leave_decided'
  | 'leave_reversed'
  | 'role_changed';

export interface NotifyInput {
  /** Recipient userId. One recipient per call — loop for several. */
  to: string;
  type: NotificationType;
  /** Template payload (§13.9). Shape is per-template; the port doesn't inspect it. */
  data?: Record<string, unknown>;
}

/** A recorded call, as the stub keeps it. */
export interface SentNotification extends NotifyInput {
  /** Wall-clock ms. Moves to `clock.now()` in PUL-108; the stub records nothing else. */
  sentAt: number;
}

const sent: SentNotification[] = [];

/**
 * Enqueue one notification.
 *
 * Stub adapter. Real notifications table + webhook_outbox land in PUL-801; this INTERFACE
 * never changes (§16.11). Fired after `withTx` commits, never inside it (§12.4 step 5) —
 * work that rolls back must not notify anyone.
 *
 * v1 records the call in memory and logs it. No DB, no webhook.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const record: SentNotification = { ...input, sentAt: Date.now() };
  sent.push(record);
  console.debug('[notify]', record.type, '→', record.to, record.data ?? {});
}

/**
 * Test-only. Reads the in-memory log — the array itself is never handed out.
 */
export function __sentNotifications(): readonly SentNotification[] {
  return [...sent];
}

/**
 * Test-only. Clears the in-memory log; call it in test setup so one test's sends
 * can't satisfy the next test's assertion.
 */
export function __resetNotifications(): void {
  sent.length = 0;
}

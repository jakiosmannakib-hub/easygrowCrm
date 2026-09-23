// features/projects/components/status-pill.tsx — PUL-407 Stage 2, §14.3.2
//
// THE canonical status pill. §14.3.2 calls it a "shared component — Board, List, Daily Plan,
// Task Detail", so it is built read-only and standalone now, and the Board (PUL-409), List and
// Calendar (PUL-410) import this one rather than each drawing their own.
//
// It lives in features/projects/ because task status is a projects-domain concept and the label
// map it reads is domain data (features/projects/display.ts). Daily Plan imports it from here,
// the same way components/shell/header.tsx imports ROLE_LABELS from the employees slice.
//
// **Read-only this stage.** §14.3.2's dropdown (EMP open set, MGR protected set, "➤ Submit for
// review…") is Stage 3 / Phase 6 and deliberately absent — there is no onChange here to
// half-wire. The one piece of §14.3.2 behavior that IS here is the dependency-blocked override,
// because it is pure display and the Task Detail header needs it now.

import { LockIcon, ShieldCheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEPENDENCY_BLOCKED_CLASSNAME, STATUS_DISPLAY, type TaskStatus } from '../display';

export function StatusPill({
  status,
  dependencyBlocked,
  className,
}: {
  status: TaskStatus;
  /**
   * Set when an unmet upstream task is holding this one back (§3.2.5). When present the pill
   * renders in the Blocked color with a lock icon **regardless of `status`**, and names the
   * dependency in its tooltip — §14.3.2's "pill shows Blocked color regardless of stored
   * status".
   *
   * Display only. The stored status is never rewritten to `blocked`; the real refusal is
   * §13.4.6's `GATE:dependency_unmet` at submit time.
   *
   * The caller decides whether the dependency is unmet (`DEPENDENCY_SATISFIED_STATUSES`) — this
   * component only draws what it is handed, so a satisfied dependency is simply not passed.
   */
  dependencyBlocked?: { title: string };
  className?: string;
}) {
  const display = STATUS_DISPLAY[status];
  const blocked = dependencyBlocked !== undefined;

  return (
    <span
      data-slot="status-pill"
      data-status={status}
      data-dependency-blocked={blocked ? '' : undefined}
      // A native `title` is the tooltip this stage: it needs no portal, no provider and no
      // client boundary, which keeps this component usable from a server component (the Board
      // and List rows are server-rendered). A shadcn Tooltip can replace it later without
      // changing any call site.
      title={blocked ? `Blocked by: ${dependencyBlocked.title}` : undefined}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-[0.625rem] font-medium whitespace-nowrap',
        blocked ? DEPENDENCY_BLOCKED_CLASSNAME : display.className,
        className
      )}
    >
      {blocked ? (
        <LockIcon aria-hidden className="size-2.5" />
      ) : display.icon ? (
        // Only `approved` carries this. It is the sole visual difference from `completed`, so
        // it is never decorative and never dropped for space.
        <ShieldCheckIcon aria-hidden className="size-2.5" />
      ) : null}
      {display.label}
    </span>
  );
}

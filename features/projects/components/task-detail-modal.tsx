// features/projects/components/task-detail-modal.tsx — PUL-407, §14.3.3
//
// The Task Detail modal: every §14.3.3 section, in order.
//
// Built in three passes, which the comments below still distinguish because the reasoning
// differs per pass:
//   Stage 2  — the shell, every section read-only against the real `getTaskDetail` shape.
//   Stage 3a — the header: status dropdown (§14.3.2), revision-note modal, Assign ▾, plus the
//              `run()` → re-fetch plumbing and CONFLICT handling everything else now reuses.
//   Stage 3b — the body: checklist, subtasks and comments, gated on the four server-computed
//              capabilities (`features/projects/capabilities.ts`).
//
// PUL-410 moved Stage 3a's status dropdown + revision-note modal out to `task-status-control.tsx`
// so the List view can reuse them, unchanged in behavior. The control owns its status writes and
// busy flag; this modal still owns the re-fetch (passed as `onChanged`) and folds the control's
// busy into its own (`anyBusy`), so every control still disables together.
//
// STILL READ-ONLY, deliberately: **actual time** and **proof**. `logActualHours` and the Submit
// modal are Phase 6 (PUL-601) — do not add inputs for them here.
//
// Every mutation goes through `run()`, which is not optimistic (§14.15 r.5: accountability
// actions wait for the server), re-reads on success so the held `version` stays current, and
// routes failures to `showErrorToast` — including `CONFLICT`'s "refresh" toast (§14.3.3).
//
// The capability booleans decide what to DRAW. The server's `authorize()` + `guardTaskChildEdit`
// decide what HAPPENS (§9.5 r.2, §16: the client displays, the server decides).

'use client';

import { CheckIcon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';
import { fmtDate, fmtHM } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { initials } from '@/features/employees/display';
import {
  addChecklistItem,
  addComment,
  addSubtask,
  assignTask,
  deleteChecklistItem,
  deleteSubtask,
  loadTaskDetail,
  toggleChecklistItem,
  toggleSubtask,
} from '../actions';
import { DEPENDENCY_SATISFIED_STATUSES, PRIORITY_LABELS, monthNumberLabel } from '../display';
import { TaskStatusControl } from './task-status-control';

/** Any action's result — `run()` only ever reads the failure half. */
type ActionOutcome = ActionResult<unknown>;

/**
 * The success payload, derived from the action rather than restated.
 *
 * Deriving it — instead of importing `TaskDetail` from `queries.ts` — is the point: a client
 * component must not import the server-only queries module at all, and taking the type off the
 * action means the `ActionResult` boundary (PUL-111) can't silently drift from what this
 * component reads. The action's success data is `{ detail, viewer, assignable } | null`;
 * `NonNullable` is the loaded case.
 */
type LoadedTask = NonNullable<
  Extract<Awaited<ReturnType<typeof loadTaskDetail>>, { ok: true }>['data']
>;

type TaskDetailData = LoadedTask['detail'];
type Viewer = LoadedTask['viewer'];
type Assignable = NonNullable<LoadedTask['assignable']>[number];
type Capabilities = LoadedTask['capabilities'];

type DetailComment = TaskDetailData['comments'][number];
type DetailSubmission = TaskDetailData['submissions'][number];

export function TaskDetailModal({
  taskId,
  open,
  onClose,
}: {
  /** Which task to show. Changing it while open re-fetches — see the `key` below. */
  taskId: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      // Reports Base UI's OWN closes only — Escape, an outside press, the × button.
      //
      // It is NOT where the fetch hangs, and that is the whole trap: Base UI calls
      // `onOpenChange` only from its internal `setOpen`. This dialog has no `Dialog.Trigger`,
      // so it is opened by a parent flipping state, and a controlled `open` prop is synced
      // straight into the store (`useControlledProp`) without going through `setOpen`. A load
      // hung off `onOpenChange` would therefore never run on the way *in*. The body below owns
      // the fetch instead. (Same bug, same fix, as OffboardingDialog — PUL-206.)
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {/*
          Mounted per opening and KEYED BY TASK: mounting is the reset. Every piece of state
          below is seeded at mount, so re-opening — or opening on a different task — starts
          clean, with no state to clear and no setState-in-effect to undo a previous visit.
        */}
        {open ? <TaskDetailBody key={taskId} taskId={taskId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailBody({ taskId }: { taskId: string }) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [assignable, setAssignable] = useState<Assignable[] | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  /** `'loading'` → `'loaded'` | `'missing'` (task gone) | `'failed'` (the read itself failed). */
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'missing' | 'failed'>('loading');

  /**
   * Bumped after every successful mutation to re-run the load effect below (PUL-407 Stage 3a).
   *
   * Re-reading is not cosmetic. `changeTaskStatusOpen` / `setTaskStatusProtected` are
   * optimistic-locked on `version`, and each one INCREMENTS it. Without a re-fetch the modal
   * would still hold the pre-write version, so the user's *second* status change in a row would
   * fail `CONFLICT` against a row nobody else touched. The re-fetch is what keeps the held
   * version current.
   *
   * A nonce rather than a re-key: re-keying the body would remount it, which would throw away
   * the loaded data and flash the loading state after every pill change. The `taskId` key stays
   * exactly as Stage 2 set it.
   */
  const [nonce, setNonce] = useState(0);
  /** True while a mutation run through `run()` is in flight. */
  const [busy, setBusy] = useState(false);
  /**
   * True while `<TaskStatusControl>` has a status write in flight. The control owns its own
   * busy state since PUL-410 extracted it; it reports it here so the rest of the modal still
   * disables with it — see `anyBusy` below.
   */
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    // Guards a stale response from an earlier opening landing on a newer one: React 19 Strict
    // Mode double-invokes effects in dev, and a fast close/re-open (or a click through to
    // another task) can leave a request in flight against an unmounted body. It guards the
    // re-fetch case too — two quick mutations can leave two loads racing, and only the newest
    // may land.
    let current = true;

    void (async () => {
      const result = await loadTaskDetail({ taskId });
      if (!current) return;

      if (!result.ok) {
        // No toast: the modal is already on screen and can say so in place, which is more
        // useful than a toast behind a dialog.
        setPhase('failed');
        return;
      }
      if (result.data === null) {
        // A normal outcome, not an error — the board that opened this can be stale.
        setPhase('missing');
        return;
      }
      setDetail(result.data.detail);
      setViewer(result.data.viewer);
      setAssignable(result.data.assignable);
      setCapabilities(result.data.capabilities);
      setPhase('loaded');
    })();

    return () => {
      current = false;
    };
    // `nonce` is the re-fetch trigger; `detail` is deliberately NOT cleared first, so the
    // current data stays on screen while the new read is in flight.
  }, [taskId, nonce]);

  /**
   * Run a mutation, then re-read. The path every control in this modal goes through, except
   * `<TaskStatusControl>`, which carries an identical `run()` of its own (PUL-410).
   *
   * Not optimistic: a status change and an assignment are accountability actions (§14.15 r.5),
   * so the UI waits for the server rather than guessing. On failure the result goes to
   * `showErrorToast`, which maps `CONFLICT` to §14.3.3's "This task changed while you were
   * editing — refresh." and every GATE reason to its own sentence (PUL-106).
   *
   * It re-fetches on failure too, deliberately: a CONFLICT means the row moved under us, so the
   * most useful next state is the current one — after which the retry has a fresh version and
   * succeeds. That turns the refresh toast into advice rather than a chore.
   */
  async function run(mutate: () => Promise<ActionOutcome>): Promise<boolean> {
    setBusy(true);
    try {
      const result = await mutate();
      if (!result.ok) {
        showErrorToast(result);
        if (result.code === 'CONFLICT') setNonce((n) => n + 1);
        return false;
      }
      setNonce((n) => n + 1);
      return true;
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Loading task…</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-xs">Fetching the task detail.</p>
      </>
    );
  }

  if (phase === 'missing') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Task not found</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-xs">
          This task has been deleted, or you&apos;re looking at a stale board. Close this and
          refresh.
        </p>
      </>
    );
  }

  if (phase === 'failed' || detail === null) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Couldn&apos;t load this task</DialogTitle>
        </DialogHeader>
        <p className="text-destructive text-xs">Close this and try again.</p>
      </>
    );
  }

  const { task, project, client, assignee, dependency } = detail;

  // §14.3.2 / §3.2.5 — an upstream task that is not finished blocks this one, whatever this
  // task's own stored status says. `cancelled` upstream deliberately does NOT count as finished.
  const dependencyBlocked =
    dependency !== null && !DEPENDENCY_SATISFIED_STATUSES.includes(dependency.status)
      ? { title: dependency.title }
      : undefined;

  // §14.3.3's unified locking rule — checklist, subtasks, hours and proof go read-only while a
  // review is pending. The status menu is NOT part of this lock: `submitted` is already outside
  // `STATUS_CHANGEABLE_FROM`, so the menu closes for its own reason (§13.4.4's locked states),
  // and a manager's override out of it is §13.4.5's separate act.
  const locked = task.status === 'submitted';

  /**
   * ONE busy state across the whole modal, as before the extraction: a status write disables
   * Assign ▾ and the body, and any `run()` mutation disables the status control.
   */
  const anyBusy = busy || statusBusy;

  // §14.3.3 Proof: the LATEST submission's proof. There is no task-level proof field — the
  // editable proof input belongs to the Phase-6 Submit modal, and must not be added here.
  // `submissions` is newest-first (getTaskDetail orders by createdAt DESC).
  const latestSubmission = detail.submissions[0];

  const doneSubtasks = detail.subtasks.filter((s) => s.done).length;

  /**
   * The four §14.3.3 body capabilities, computed SERVER-SIDE by `taskCapabilities` and returned
   * with the data (Stage 3b). The fallback is all-false: if the payload somehow lacks them, the
   * body renders read-only rather than optimistically enabled.
   *
   * These decide what to DRAW. Every control they enable is re-authorized by its action.
   */
  const caps = capabilities ?? {
    canToggleChecklist: false,
    canManageChecklist: false,
    canManageSubtasks: false,
    canComment: false,
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{task.title}</DialogTitle>
        <p className="text-muted-foreground text-xs">
          {/* Breadcrumb. "Month N" is omitted entirely when the task has no month — an ad-hoc
              task is not "Month 0". */}
          {client.name} › {project.name} · {task.category}
          {task.month !== null ? ` · ${monthNumberLabel(task.month)}` : ''}
        </p>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {/*
          §14.3.2's status control (read-only pill or dropdown, plus the revision-note modal),
          extracted in PUL-410 so the List view can reuse it. `onChanged` is this modal's
          re-fetch — the same nonce bump `run()` does, so the held `version` stays current.
        */}
        <TaskStatusControl
          task={{
            id: taskId,
            title: task.title,
            status: task.status,
            version: task.version,
            assigneeId: task.assigneeId,
          }}
          viewer={viewer}
          dependencyBlocked={dependencyBlocked}
          disabled={busy}
          onBusyChange={setStatusBusy}
          onChanged={() => setNonce((n) => n + 1)}
        />

        <span className="text-muted-foreground">
          Priority: <span className="text-foreground">{PRIORITY_LABELS[task.priority]}</span>
        </span>
        <span className="text-muted-foreground">
          {/* Always through fmtDate — full date with year, never a bare month-day (§14.15 r.2). */}
          Due: <span className="text-foreground">{fmtDate(task.dueDate) || 'No due date'}</span>
        </span>

        {/*
          §14.3.3: a manager gets Assign ▾; everyone else sees the assignee read-only. `assignable`
          is non-null exactly when the server said this viewer holds `project_task.assign`, so the
          picker's existence is a server decision, not a client role guess.
        */}
        {assignable !== null ? (
          <span className="flex items-center gap-1.5">
            {/* The avatar stays OUTSIDE the trigger: `Select.Value` renders a bare text label,
                and a manager should still see the same face everyone else does. */}
            {assignee ? (
              <Avatar size="sm">
                {assignee.image ? <AvatarImage src={assignee.image} alt="" /> : null}
                <AvatarFallback>{initials(assignee.name)}</AvatarFallback>
              </Avatar>
            ) : null}
            <AssignPicker
              assignable={assignable}
              currentAssigneeId={task.assigneeId}
              // The stored assignee, which is NOT necessarily in `assignable` — see the
              // component's docblock.
              currentAssignee={assignee}
              disabled={anyBusy}
              onSelect={(assigneeId) => void run(() => assignTask({ taskId, assigneeId }))}
            />
          </span>
        ) : assignee ? (
          <span className="flex items-center gap-1.5">
            <Avatar size="sm">
              {assignee.image ? <AvatarImage src={assignee.image} alt="" /> : null}
              <AvatarFallback>{initials(assignee.name)}</AvatarFallback>
            </Avatar>
            {assignee.name}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </div>

      {locked ? (
        // §14.3.3's banner, verbatim. The copy is the contract: it tells the assignee exactly
        // which things went read-only and that the conversation did not.
        <p className="border-border bg-muted text-muted-foreground rounded-md border p-3 text-xs">
          Awaiting review — checklist, subtasks and hours are locked. Comments stay open.
        </p>
      ) : null}

      <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
        <Section title="Description">
          {task.description ? (
            <p className="whitespace-pre-wrap">{task.description}</p>
          ) : (
            <Empty>No description.</Empty>
          )}
          {task.sopUrl ? (
            <p>
              <a
                href={task.sopUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                SOP
              </a>
            </p>
          ) : null}
          {task.expectedOutput ? (
            <p className="text-muted-foreground">
              <span className="font-medium">Expected output:</span> {task.expectedOutput}
            </p>
          ) : null}
        </Section>

        {/* The definition-of-done, and the §13.4.6 submit gate (PUL-601). Toggling is the
            assignee's or a manager's; add/delete are MGR-only (§13.4.10). */}
        <Section
          title="Checklist"
          count={
            detail.checklistTotal > 0
              ? `(${detail.checklistDone}/${detail.checklistTotal})`
              : undefined
          }
        >
          {detail.checklist.length === 0 ? (
            <Empty>No checklist items.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detail.checklist.map((item) => (
                <CheckRow
                  key={item.id}
                  text={item.text}
                  done={item.done}
                  disabled={!caps.canToggleChecklist || anyBusy}
                  onToggle={(done) => void run(() => toggleChecklistItem({ itemId: item.id, done }))}
                  // HIDDEN, not disabled, when the viewer can't manage: an employee should never
                  // see a × they may not use (§14.1 curated visibility).
                  onDelete={
                    caps.canManageChecklist
                      ? () => void run(() => deleteChecklistItem({ itemId: item.id }))
                      : undefined
                  }
                />
              ))}
            </ul>
          )}

          {caps.canManageChecklist ? (
            <AddRow
              placeholder="Add a checklist item"
              busy={anyBusy}
              onAdd={(text) => run(() => addChecklistItem({ taskId, text }))}
            />
          ) : null}
        </Section>

        {/* Subtasks are NOT a submission gate (§9.6 ⁷, §16.8) — they only help the assignee
            break the work down. Never add a gate here. Add/toggle/delete share ONE permission
            (`project_task.subtask_manage`), unlike the checklist's split. */}
        <Section
          title="Subtasks"
          count={
            detail.subtasks.length > 0
              ? `(${doneSubtasks}/${detail.subtasks.length})`
              : undefined
          }
        >
          {detail.subtasks.length === 0 ? (
            <Empty>No subtasks yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {detail.subtasks.map((subtask) => (
                <CheckRow
                  key={subtask.id}
                  text={subtask.text}
                  done={subtask.done}
                  disabled={!caps.canManageSubtasks || anyBusy}
                  onToggle={(done) =>
                    void run(() => toggleSubtask({ subtaskId: subtask.id, done }))
                  }
                  onDelete={
                    caps.canManageSubtasks
                      ? () => void run(() => deleteSubtask({ subtaskId: subtask.id }))
                      : undefined
                  }
                />
              ))}
            </ul>
          )}

          {caps.canManageSubtasks ? (
            <AddRow
              placeholder="Add a subtask"
              busy={anyBusy}
              onAdd={(text) => run(() => addSubtask({ taskId, text }))}
            />
          ) : null}
        </Section>

        <Section title="Actual time">
          <p>{fmtHM(task.actualHours)}</p>
          <p className="text-muted-foreground">from your time-tracking tool</p>
        </Section>

        <Section title="Proof">
          {latestSubmission && latestSubmission.proofValue ? (
            <p>
              <span className="text-muted-foreground">{latestSubmission.proofType}:</span>{' '}
              {latestSubmission.proofValue}
            </p>
          ) : (
            <Empty>No proof submitted yet.</Empty>
          )}
        </Section>

        {/* Comments never lock, at any status (§3.2.3) — the box stays live on a submitted or
            approved task, which is exactly what the lock banner promises. The ONLY thing that
            closes it is an archived project (§13.3.4), which is `canComment`'s one false case.
            Oldest first — a conversation reads top to bottom. */}
        <Section title="Comments">
          {detail.comments.length === 0 ? (
            <Empty>No comments yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.comments.map((comment) => (
                <CommentRow key={comment.id} comment={comment} />
              ))}
            </ul>
          )}

          {caps.canComment ? (
            <CommentComposer
              busy={anyBusy}
              onPost={(body) => run(() => addComment({ taskId, body }))}
            />
          ) : (
            <p className="text-muted-foreground">
              This project is archived — commenting is closed.
            </p>
          )}
        </Section>

        {/* Empty until Phase 6 writes submissions and reviews; the shape is final now. */}
        <Section title="Submission & review history">
          {detail.submissions.length === 0 ? (
            <Empty>Not submitted for review yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.submissions.map((submission) => (
                <SubmissionRow key={submission.id} submission={submission} />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

/**
 * §13.4.3's Assign ▾ — managers only, and only ever offered active non-SA users, because
 * `assignableUsersQuery` is what populated it.
 *
 * `UNASSIGN` is a sentinel rather than an empty string: Base UI treats `''` as "no value", so an
 * empty-string item cannot be selected. The same trick as the offboarding dialog's `CANCEL`.
 */
const UNASSIGN = '__unassign__';

function AssignPicker({
  assignable,
  currentAssigneeId,
  currentAssignee,
  disabled,
  onSelect,
}: {
  assignable: Assignable[];
  currentAssigneeId: string | null;
  /**
   * The person actually on the task, from `getTaskDetail` — which reads the `user` row directly
   * and therefore returns someone `assignable` may not contain.
   *
   * That gap is real, not theoretical: `assignableUsersQuery` returns only ACTIVE non-SA users,
   * so a task still held by someone since deactivated has an assignee who is deliberately not a
   * selectable option. The trigger must name them anyway — the same rule §14.3.2 states for the
   * status pill ("current status always shown even if outside the option set"), for the same
   * reason: hiding the current value makes the control lie about the row.
   */
  currentAssignee: { id: string; name: string } | null;
  disabled: boolean;
  onSelect: (assigneeId: string | null) => void;
}) {
  /**
   * What the trigger shows for a given selected value.
   *
   * `Select.Value` must be given a children FUNCTION. Left bare it calls Base UI's
   * `resolveSelectedLabel(value, items, …)`, and because this Select passes no `items` map to
   * the Root, that falls through to `String(value)` — which is the user's database ID. That is
   * exactly the bug QA hit: the trigger read `qa_assignee` instead of "QA Assignee".
   */
  function labelFor(value: string | null): string {
    if (value === null || value === UNASSIGN) return 'Unassigned';

    const candidate = assignable.find((person) => person.id === value);
    if (candidate) return candidate.name;

    // Not in the option set — the deactivated-holder case above.
    if (currentAssignee && currentAssignee.id === value) return currentAssignee.name;

    // Defensive only: a provisioned account always has a name (`user.name` is NOT NULL and
    // HR-owned, §PUL-203), so this is unreachable rather than a real fallback. Better a vague
    // word than a raw id if it ever is reached.
    return 'Unassigned';
  }

  return (
    <Select
      value={currentAssigneeId ?? UNASSIGN}
      onValueChange={(next: string | null) => {
        if (next === null) return;
        const assigneeId = next === UNASSIGN ? null : next;
        // `assignTask` treats "no change" as a no-op server-side, but stopping here saves the
        // round trip and the re-fetch that would follow it.
        if (assigneeId === currentAssigneeId) return;
        onSelect(assigneeId);
      }}
    >
      <SelectTrigger size="sm" aria-label="Assign to" disabled={disabled}>
        <SelectValue placeholder="Unassigned">
          {(value: string | null) => labelFor(value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGN}>Unassigned</SelectItem>
        {assignable.map((candidate) => (
          <SelectItem key={candidate.id} value={candidate.id}>
            {candidate.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  /** e.g. `(3/5)` — §14.3.3 shows it only when the section is populated. */
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-xs font-medium">
        {title}
        {count ? <span className="text-muted-foreground font-normal"> {count}</span> : null}
      </h4>
      <div className="flex flex-col gap-1.5 text-xs">{children}</div>
    </section>
  );
}

/** §14.15 r.4 — an empty state that explains itself rather than a blank area. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

/**
 * One checklist or subtask row.
 *
 * `disabled` and `onDelete` express the two different ways a viewer can lack a right, and the
 * difference is deliberate (§14.1 curated visibility):
 *   - **Disabled** checkbox: the row is still information the viewer should see, they just may
 *     not change it. A greyed checkbox reads as "not yours", which is true.
 *   - **Absent** ×: `onDelete` omitted removes the button entirely rather than greying it. A
 *     delete affordance an employee may never use is noise that invites a pointless click and a
 *     FORBIDDEN toast.
 */
function CheckRow({
  text,
  done,
  disabled,
  onToggle,
  onDelete,
}: {
  text: string;
  done: boolean;
  disabled: boolean;
  onToggle: (done: boolean) => void;
  /** Omit to hide the × entirely — see the docblock. */
  onDelete?: () => void;
}) {
  return (
    <li className="group/row flex items-center gap-2">
      <input
        type="checkbox"
        checked={done}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        className="accent-primary size-3.5 shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className={done ? 'text-muted-foreground flex-1 line-through' : 'flex-1'}>{text}</span>
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label={`Remove "${text}"`}
          className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </li>
  );
}

/**
 * The inline "+ Add …" row under the checklist and the subtask list.
 *
 * ENTER submits (§14.3.3 "Enter to add"), which is the whole point of an inline adder — a
 * manager entering five checklist items should never touch the mouse. The button is the same
 * action for anyone who does.
 *
 * Clears itself on success only: a failed add keeps the text so it isn't retyped.
 */
function AddRow({
  placeholder,
  busy,
  onAdd,
}: {
  placeholder: string;
  busy: boolean;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  async function submit() {
    if (trimmed === '' || busy) return;
    const ok = await onAdd(trimmed);
    if (ok) setText('');
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        className="h-7 flex-1 text-xs"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={trimmed === '' || busy}
        onClick={() => void submit()}
      >
        Add
      </Button>
    </div>
  );
}

/**
 * The comment box. Deliberately NOT Enter-to-submit, unlike `AddRow`: a comment is prose that
 * routinely wants a line break, and a stray Enter posting a half-written thought is worse than
 * one extra click. The add-rows are single-line values where the opposite is true.
 *
 * Posting is not optimistic — §14.15 r.5 reserves optimistic UI for pill changes and reads; a
 * comment is a permanent attributed record, so it waits for the server and then re-reads.
 */
function CommentComposer({
  busy,
  onPost,
}: {
  busy: boolean;
  onPost: (body: string) => Promise<boolean>;
}) {
  const [body, setBody] = useState('');
  const trimmed = body.trim();

  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        aria-label="Add a comment"
        placeholder="Add a comment…"
        disabled={busy}
        className="border-input bg-input/20 focus-visible:border-ring focus-visible:ring-ring/30 dark:bg-input/30 w-full rounded-md border px-2 py-1.5 text-xs/relaxed outline-none focus-visible:ring-2 disabled:opacity-50"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={trimmed === '' || busy}
          onClick={() => {
            void (async () => {
              const ok = await onPost(trimmed);
              if (ok) setBody('');
            })();
          }}
        >
          {busy ? 'Posting…' : 'Post'}
        </Button>
      </div>
    </div>
  );
}

function CommentRow({ comment }: { comment: DetailComment }) {
  return (
    <li className="flex gap-2">
      <Avatar size="sm">
        {comment.author.image ? <AvatarImage src={comment.author.image} alt="" /> : null}
        <AvatarFallback>{initials(comment.author.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{comment.author.name}</span>
          <span className="text-muted-foreground">{fmtTimestamp(comment.createdAt)}</span>
        </p>
        <p className="whitespace-pre-wrap">{comment.body}</p>
      </div>
    </li>
  );
}

function SubmissionRow({ submission }: { submission: DetailSubmission }) {
  const { review } = submission;

  return (
    <li className="border-border flex flex-col gap-1 rounded-md border p-2">
      <p className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{submission.submittedBy.name}</span>
        <span className="text-muted-foreground">{fmtTimestamp(submission.createdAt)}</span>
        {submission.hours !== null ? (
          <span className="text-muted-foreground">· {fmtHM(submission.hours)}</span>
        ) : null}
      </p>
      {submission.summary ? <p className="whitespace-pre-wrap">{submission.summary}</p> : null}
      {submission.issues ? (
        <p className="text-muted-foreground whitespace-pre-wrap">
          <span className="font-medium">Issues:</span> {submission.issues}
        </p>
      ) : null}

      {review === null ? (
        <p className="text-muted-foreground">Awaiting review.</p>
      ) : (
        <div className="border-border flex flex-col gap-1 border-t pt-1">
          <p className="flex flex-wrap items-center gap-x-1.5">
            {review.decision === 'approved' ? (
              <CheckIcon aria-hidden className="size-3 text-teal-600" />
            ) : (
              <TriangleAlertIcon aria-hidden className="size-3 text-orange-600" />
            )}
            <span className="font-medium">
              {review.decision === 'approved' ? 'Approved' : 'Needs revision'}
            </span>
            <span className="text-muted-foreground">by {review.reviewer.name}</span>
          </p>
          {review.note ? <p className="whitespace-pre-wrap">{review.note}</p> : null}
          {review.rating !== null ? (
            <p className="text-muted-foreground">
              Rating: <Stars value={review.rating} />
            </p>
          ) : null}
          {review.metaRating !== null ? (
            <p className="text-muted-foreground">
              Review quality: <Stars value={review.metaRating} />
            </p>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** Out of five, filled then hollow, with the number for anyone who can't see the difference. */
function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="text-foreground">
      <span aria-hidden>
        {'★'.repeat(filled)}
        {'☆'.repeat(5 - filled)}
      </span>
      <span className="sr-only">{filled} out of 5</span>
    </span>
  );
}

/**
 * A comment / submission timestamp: the §14.15 r.2 full date (year included, via `fmtDate`) plus
 * the Dhaka wall-clock time.
 *
 * The calendar day is derived in Asia/Dhaka rather than the browser's zone — a `createdAt` near
 * midnight is otherwise labelled with yesterday's date for anyone whose laptop is on another
 * timezone. `fmtDate` then adds its own `· Today` suffix, which is exactly what a conversation
 * wants.
 */
const DHAKA_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DHAKA_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Dhaka',
  hour: 'numeric',
  minute: '2-digit',
});

function fmtTimestamp(at: Date): string {
  return `${fmtDate(DHAKA_DAY.format(at))} · ${DHAKA_TIME.format(at)}`;
}

// features/projects/components/task-detail-modal.tsx — PUL-407 Stage 2, §14.3.3
//
// The Task Detail modal SHELL: every §14.3.3 section, rendered READ-ONLY.
//
// **Stage 2 is deliberately inert.** Every control below is disabled and nothing here calls a
// mutation. Stage 3 wires the checklist/subtask toggles, the Assign ▾, the status dropdown and
// the actual-time input; Phase 6 adds the Submit and Review modals. The sections exist now — in
// §14.3.3's order, against the final `getTaskDetail` shape — so those tickets fill in behavior
// without re-laying out the modal, and so the read can be QA'd against real data first.
//
// There is deliberately NO version-conflict handling (§14.3.3's CONFLICT toast): nothing here
// writes, so there is no `version` to lose a race with yet.

'use client';

import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fmtDate, fmtHM } from '@/lib/format';
import { initials } from '@/features/employees/display';
import { loadTaskDetail } from '../actions';
import { DEPENDENCY_SATISFIED_STATUSES, PRIORITY_LABELS } from '../display';
import { StatusPill } from './status-pill';

/**
 * The success payload, derived from the action rather than restated.
 *
 * Deriving it — instead of importing `TaskDetail` from `queries.ts` — is the point: a client
 * component must not import the server-only queries module at all, and taking the type off the
 * action means the `ActionResult` boundary (PUL-111) can't silently drift from what this
 * component reads. The action's success data is `TaskDetail | null`; `NonNullable` is the
 * loaded case.
 */
type TaskDetailData = NonNullable<
  Extract<Awaited<ReturnType<typeof loadTaskDetail>>, { ok: true }>['data']
>;

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
  /** `'loading'` → `'loaded'` | `'missing'` (task gone) | `'failed'` (the read itself failed). */
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'missing' | 'failed'>('loading');

  useEffect(() => {
    // Guards a stale response from an earlier opening landing on a newer one: React 19 Strict
    // Mode double-invokes effects in dev, and a fast close/re-open (or a click through to
    // another task) can leave a request in flight against an unmounted body.
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
      setDetail(result.data);
      setPhase('loaded');
    })();

    return () => {
      current = false;
    };
  }, [taskId]);

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

  // §14.3.3's unified locking rule. Stage 2 is read-only throughout, so this drives the banner
  // only; Stage 3 reads the same flag to disable the controls it adds.
  const locked = task.status === 'submitted';

  // §14.3.3 Proof: the LATEST submission's proof. There is no task-level proof field — the
  // editable proof input belongs to the Phase-6 Submit modal, and must not be added here.
  // `submissions` is newest-first (getTaskDetail orders by createdAt DESC).
  const latestSubmission = detail.submissions[0];

  const doneSubtasks = detail.subtasks.filter((s) => s.done).length;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{task.title}</DialogTitle>
        <p className="text-muted-foreground text-xs">
          {/* Breadcrumb. "Month N" is omitted entirely when the task has no month — an ad-hoc
              task is not "Month 0". */}
          {client.name} › {project.name} · {task.category}
          {task.month !== null ? ` · Month ${task.month}` : ''}
        </p>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <StatusPill status={task.status} dependencyBlocked={dependencyBlocked} />
        <span className="text-muted-foreground">
          Priority: <span className="text-foreground">{PRIORITY_LABELS[task.priority]}</span>
        </span>
        <span className="text-muted-foreground">
          {/* Always through fmtDate — full date with year, never a bare month-day (§14.15 r.2). */}
          Due: <span className="text-foreground">{fmtDate(task.dueDate) || 'No due date'}</span>
        </span>
        {/* Assign ▾ is Stage 3 (§13.4.3, MGR only). Display only for now. */}
        {assignee ? (
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

        {/* The definition-of-done, and the §13.4.6 submit gate. Toggling is Stage 3
            (`project_task.checklist_toggle`); add/delete are MGR-only and also Stage 3. */}
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
                <CheckRow key={item.id} text={item.text} done={item.done} />
              ))}
            </ul>
          )}
        </Section>

        {/* Subtasks are NOT a submission gate (§9.6 ⁷, §16.8) — they only help the assignee
            break the work down. Never add a gate here. */}
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
                <CheckRow key={subtask.id} text={subtask.text} done={subtask.done} />
              ))}
            </ul>
          )}
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

        {/* Comments never lock, at any status (§3.2.3). Oldest first — a conversation reads top
            to bottom. Posting is Stage 3; `addComment` (§13.4.11) already exists. */}
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
 * One checklist or subtask row. `disabled` this stage for everyone, not conditionally: Stage 3
 * introduces the real rule, which is per-permission and per-status (§9.6 ⁷ + the submitted
 * lock), and a half-applied version of it now would be worse than an honest read-only.
 */
function CheckRow({ text, done }: { text: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={done}
        disabled
        readOnly
        className="size-3.5 shrink-0 accent-primary"
      />
      <span className={done ? 'text-muted-foreground line-through' : undefined}>{text}</span>
    </li>
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

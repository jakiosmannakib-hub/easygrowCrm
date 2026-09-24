// features/projects/components/task-status-control.tsx — PUL-410 Stage 1, §14.3.2
//
// The §14.3.2 status control, extracted from the Task Detail modal (PUL-407 Stage 3a) so the
// List view (PUL-410) can put the same dropdown in a row. Behavior-neutral: this is the modal's
// code moved, not re-derived.
//
// What it owns:
//   - the read-only pill vs. dropdown decision (`statusMenuOptions` in display.ts — the option
//     sets stay there, this only consumes them);
//   - routing a choice to §13.4.4 `changeTaskStatusOpen` or §13.4.5 `setTaskStatusProtected`;
//   - §13.4.5's revision-note modal, one instance per control;
//   - its own `busy` flag and the failure toast (CONFLICT → "refresh", via `showErrorToast`).
//
// What it does NOT own: re-reading the task. On success — and on CONFLICT, see `run()` — it
// calls `onChanged()` and the caller re-fetches, which is how the held `version` stays current.
//
// The options decide what to DRAW. The actions' `authorize()` decides what HAPPENS (§16).

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { ActionResult } from '@/lib/action-result';
import { showErrorToast } from '@/lib/show-error-toast';
import { changeTaskStatusOpen, setTaskStatusProtected } from '../actions';
import {
  isProtectedStatus,
  statusMenuLabel,
  statusMenuOptions,
  type StatusMenuViewer,
  type TaskStatus,
} from '../display';
import { StatusPill } from './status-pill';

/** The task fields the control reads — the minimum both the modal and a list row can supply. */
export interface StatusControlTask {
  id: string;
  /** Named in the revision-note modal's description. */
  title: string;
  status: TaskStatus;
  /** The optimistic-lock version from the caller's last read. */
  version: number;
  /** Decides whether an employee viewer is the assignee (§14.3.2's EMP option set). */
  assigneeId: string | null;
}

export function TaskStatusControl({
  task,
  viewer,
  dependencyBlocked,
  disabled = false,
  onBusyChange,
  onChanged,
}: {
  task: StatusControlTask;
  /** `null` ⇒ read-only pill (no viewer loaded yet). */
  viewer: StatusMenuViewer | null;
  /** §3.2.5's display-only override: Blocked color + lock + tooltip naming the upstream task. */
  dependencyBlocked?: { title: string };
  /** The caller's own in-flight flag — e.g. the modal disabling everything during an assign. */
  disabled?: boolean;
  /**
   * Reports this control's in-flight state upward, so a caller can disable its OTHER controls
   * while a status write is in flight. The Task Detail modal uses it to keep its pre-extraction
   * behavior: one busy state across the whole modal.
   */
  onBusyChange?: (busy: boolean) => void;
  /** Called after a successful write, and after a CONFLICT. The caller re-reads the task. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /** §13.4.5's revision note is collected in its own modal before the write happens. */
  const [revisionOpen, setRevisionOpen] = useState(false);

  function setBusyBoth(next: boolean) {
    setBusy(next);
    onBusyChange?.(next);
  }

  /**
   * Run a status write, then have the caller re-read. Same contract as the modal's `run()`.
   *
   * Not optimistic: a status change is an accountability action (§14.15 r.5). On failure the
   * result goes to `showErrorToast`, which maps `CONFLICT` to §14.3.3's "This task changed while
   * you were editing — refresh." and every GATE reason to its own sentence (PUL-106).
   *
   * `onChanged()` fires on CONFLICT too, deliberately: the row moved under us, so the most useful
   * next state is the current one, after which the retry has a fresh version and succeeds.
   */
  async function run(mutate: () => Promise<ActionResult<unknown>>): Promise<boolean> {
    setBusyBoth(true);
    try {
      const result = await mutate();
      if (!result.ok) {
        showErrorToast(result);
        if (result.code === 'CONFLICT') onChanged();
        return false;
      }
      onChanged();
      return true;
    } finally {
      setBusyBoth(false);
    }
  }

  // §14.3.2's option set for THIS viewer on THIS task. Empty ⇒ the pill renders read-only.
  const options = viewer ? statusMenuOptions(task.status, viewer, task.assigneeId) : [];

  /**
   * Route a chosen status to the right §13 action.
   *
   * `revision_required` does NOT write here — §13.4.5 requires a note, so it opens the note
   * modal and the write happens on that modal's submit. Everything else splits on
   * `isProtectedStatus`: the open set goes to §13.4.4, `completed` / `cancelled` to §13.4.5.
   */
  function onSelect(next: TaskStatus) {
    if (next === task.status) return;

    if (next === 'revision_required') {
      setRevisionOpen(true);
      return;
    }

    void run(() =>
      isProtectedStatus(next)
        ? setTaskStatusProtected({
            taskId: task.id,
            version: task.version,
            status: next as 'completed' | 'cancelled',
          })
        : changeTaskStatusOpen({
            taskId: task.id,
            version: task.version,
            status: next as 'planned' | 'in_progress' | 'blocked',
          }),
    );
  }

  return (
    <>
      {/*
        §14.3.2: "current status always shown even if outside the option set". With no options
        the pill IS the display — which covers the locked states, HR, and a non-assignee EMP.
        The dependency-blocked override rides on both paths, so a blocked-by-dependency task
        still reads as Blocked even while its owner can change the underlying status.
      */}
      {options.length === 0 ? (
        <StatusPill status={task.status} dependencyBlocked={dependencyBlocked} />
      ) : (
        <StatusMenu
          status={task.status}
          options={options}
          dependencyBlocked={dependencyBlocked}
          disabled={busy || disabled}
          onSelect={onSelect}
        />
      )}

      {/*
        §13.4.5's revision-note modal. When the control sits in the Task Detail modal this nests
        inside it rather than replacing it: the manager is writing the note ABOUT what they are
        looking at, so the task stays behind it. Keyed by `revisionOpen` so each opening starts
        with an empty textarea.
      */}
      <RevisionNoteDialog
        key={revisionOpen ? 'open' : 'closed'}
        open={revisionOpen}
        taskTitle={task.title}
        busy={busy || disabled}
        onClose={() => setRevisionOpen(false)}
        onSubmit={async (note) => {
          const ok = await run(() =>
            setTaskStatusProtected({
              taskId: task.id,
              version: task.version,
              status: 'revision_required',
              note,
            }),
          );
          if (ok) setRevisionOpen(false);
        }}
      />
    </>
  );
}

/**
 * The §14.3.2 status dropdown.
 *
 * The trigger renders the `StatusPill` itself rather than Base UI's `SelectValue`, for a reason
 * that is not cosmetic: §14.3.2 requires the CURRENT status to show "even if outside the option
 * set", and a task in `revision_required` is exactly that case for its assignee — the menu
 * offers the three open statuses while the pill must still read "Needs revision". Driving the
 * trigger off `SelectValue` would blank it whenever the value has no matching item.
 *
 * `onValueChange` (which yields `string | null` on Base UI) is the only signal read.
 */
function StatusMenu({
  status,
  options,
  dependencyBlocked,
  disabled,
  onSelect,
}: {
  status: TaskStatus;
  options: TaskStatus[];
  dependencyBlocked?: { title: string };
  disabled: boolean;
  onSelect: (next: TaskStatus) => void;
}) {
  return (
    <Select
      value={status}
      onValueChange={(next: string | null) => {
        if (next !== null) onSelect(next as TaskStatus);
      }}
    >
      <SelectTrigger size="sm" aria-label="Change status" disabled={disabled} className="gap-2">
        <StatusPill status={status} dependencyBlocked={dependencyBlocked} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {statusMenuLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * §13.4.5's "say why" modal, shown before a task is sent back for revision.
 *
 * The empty-note check is client-side convenience only — the server returns
 * `GATE:note_required` regardless, and that is the real rule. Blocking the button here just
 * means the common mistake costs no round trip; it is not what enforces the note.
 */
function RevisionNoteDialog({
  open,
  taskTitle,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  taskTitle: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const trimmed = note.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send back for revision</DialogTitle>
          <DialogDescription>
            {taskTitle} — the assignee sees this note, so say what needs changing.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          autoFocus
          aria-label="Revision note"
          placeholder="What needs changing?"
          className="border-input bg-input/20 focus-visible:border-ring focus-visible:ring-ring/30 w-full rounded-md border px-2 py-1.5 text-xs/relaxed outline-none focus-visible:ring-2 dark:bg-input/30"
        />

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
          <Button
            variant="destructive"
            disabled={trimmed === '' || busy}
            onClick={() => onSubmit(trimmed)}
          >
            {busy ? 'Sending…' : 'Send back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

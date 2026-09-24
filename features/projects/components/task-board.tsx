// features/projects/components/task-board.tsx — PUL-409 Stage 1, §14.3.1
//
// The Board tab: the pinned Unassigned group, then six Kanban columns by status.
//
// **A presentation of the filter bar's rows, not a reader of its own.** The board takes the
// `getFilteredTasks` result the filter bar already holds and draws it; it never fetches. That is
// what makes PUL-408's "filter changes update every tab identically" true by construction — List
// and Calendar will receive the very same array (§16.9, PUL-408.3).
//
// Clicking a card opens PUL-407's `TaskDetailModal`. On close the board tells its parent via
// `onTaskClosed`, which re-reads the task list, so a status or assignee change made in the modal
// moves the card — to another column, or out of (or into) the Unassigned group.
//
// Stage 2 (not here): per-column `+ Add task` for managers, reusing `NewTaskModal`.

'use client';

import { LockIcon } from 'lucide-react';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { fmtDate, dhakaToday } from '@/lib/format';
import { cn } from '@/lib/utils';
import { initials } from '@/features/employees/display';
import {
  BOARD_COLUMN_BORDER,
  BOARD_STATUSES,
  PRIORITY_LABELS,
  PRIORITY_PILL_CLASSNAME,
  STATUS_DISPLAY,
  groupBoardTasks,
  overdueDays,
} from '../display';
import { TaskDetailModal } from './task-detail-modal';
import type { FilteredTaskRow } from '../queries';

export function TaskBoard({
  tasks,
  loading,
  onTaskClosed,
}: {
  /** The filter bar's current `getFilteredTasks` result — the board never fetches its own. */
  tasks: FilteredTaskRow[];
  /** True while the filter bar is re-reading. */
  loading: boolean;
  /** Called when the Task Detail modal closes, so the parent can re-read the list. */
  onTaskClosed: () => void;
}) {
  // One piece of state, not a boolean plus an id: `openTaskId` IS the open flag, so the two can
  // never disagree (same shape as the PUL-407 QA harness this replaces).
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Read once per render and shared by every card, so two cards can't straddle midnight and
  // disagree about what "today" is. `dhakaToday()` reads the clock port (§16.6).
  const today = dhakaToday();

  // Nothing to show yet — the first read is still in flight with no rows to hold on screen.
  if (loading && tasks.length === 0) return <BoardSkeleton />;

  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-md border border-dashed p-10 text-center text-sm">
        No tasks match these filters.
      </div>
    );
  }

  const { unassigned, columns } = groupBoardTasks(tasks);

  return (
    <>
      {/*
        While a refetch is in flight the current board stays up, dimmed, rather than collapsing
        to a skeleton: re-reading after every modal close would otherwise flash the whole board
        away and back each time a card is opened.
      */}
      <div
        aria-busy={loading}
        className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}
      >
        {/*
          §14.3.1: pinned ABOVE the columns, and only when something is unassigned. Managers
          assign from here via the card's Task Detail modal (§13.4.3 — there is no self-claim).
        */}
        {unassigned.length > 0 ? (
          <section
            aria-label="Unassigned"
            className="border-border rounded-md border border-dashed p-3"
          >
            <h2 className="mb-2 flex items-center gap-2 text-xs font-medium">
              Unassigned
              <CountChip count={unassigned.length} className="bg-muted text-muted-foreground" />
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">
              {unassigned.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  today={today}
                  onOpen={() => setOpenTaskId(task.id)}
                />
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
          {columns.map(({ status, tasks: columnTasks }) => (
            <section
              key={status}
              aria-label={STATUS_DISPLAY[status].label}
              className={cn(
                'bg-muted/30 border-border flex min-h-32 flex-col rounded-md border border-t-4 p-2',
                BOARD_COLUMN_BORDER[status],
              )}
            >
              <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-medium">
                {STATUS_DISPLAY[status].label}
                <CountChip count={columnTasks.length} className={STATUS_DISPLAY[status].className} />
              </h2>
              <div className="flex flex-col gap-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    today={today}
                    onOpen={() => setOpenTaskId(task.id)}
                  />
                ))}
              </div>
              {/* Stage 2: the MGR-only `+ Add task` button lands here, at the column's foot. */}
            </section>
          ))}
        </div>
      </div>

      {/*
        One modal for the whole board, keyed inside by taskId. It stays mounted with the last id
        while it animates out (`open` false), which is why `taskId` falls back to '' rather than
        unmounting the modal.
      */}
      <TaskDetailModal
        taskId={openTaskId ?? ''}
        open={openTaskId !== null}
        onClose={() => {
          setOpenTaskId(null);
          onTaskClosed();
        }}
      />
    </>
  );
}

function CountChip({ count, className }: { count: number; className: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 text-[0.625rem] leading-4 font-medium tabular-nums',
        className,
      )}
    >
      {count}
    </span>
  );
}

/**
 * One §14.3.1 card: title · category tag · priority pill · assignee avatar · full due date with
 * year · `☑ done/total` subtask badge (hidden at zero) · red `Overdue Nd` line when past due.
 */
function TaskCard({
  task,
  today,
  onOpen,
}: {
  task: FilteredTaskRow;
  today: string;
  onOpen: () => void;
}) {
  const overdue = overdueDays(task.dueDate, today, task.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card border-border hover:border-foreground/30 focus-visible:ring-ring flex w-full flex-col gap-2 rounded-md border p-2.5 text-left text-xs shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="flex items-start gap-1.5">
        {/*
          §3.2.5's display-only dependency lock. The card only says THAT it is blocked; the
          modal's status pill carries the tooltip naming the upstream task.
        */}
        {task.dependencyBlocked ? (
          <LockIcon
            aria-label="Blocked by a dependency"
            className="mt-0.5 size-3 shrink-0 text-red-600 dark:text-red-400"
          />
        ) : null}
        <span className="line-clamp-2 font-medium">{task.title}</span>
      </span>

      <span className="flex flex-wrap items-center gap-1">
        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.625rem]">
          {task.category}
        </span>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[0.625rem]',
            PRIORITY_PILL_CLASSNAME[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
        {task.subtaskTotal > 0 ? (
          <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[0.625rem] text-teal-700 tabular-nums dark:text-teal-300">
            ☑ {task.subtaskDone}/{task.subtaskTotal}
          </span>
        ) : null}
      </span>

      <span className="flex items-center justify-between gap-2">
        {/* Always through fmtDate — the full date with year, never a bare month-day (§14.15 r.2). */}
        <span className="text-muted-foreground">{fmtDate(task.dueDate) || 'No due date'}</span>
        {task.assignee ? (
          <Avatar size="sm" title={task.assignee.name}>
            {task.assignee.image ? <AvatarImage src={task.assignee.image} alt="" /> : null}
            <AvatarFallback>{initials(task.assignee.name)}</AvatarFallback>
          </Avatar>
        ) : null}
      </span>

      {overdue !== null ? (
        <span className="font-medium text-red-600 dark:text-red-400">Overdue {overdue}d</span>
      ) : null}
    </button>
  );
}

/** Six pulsing columns in the board's own geometry, so the layout doesn't jump when rows land. */
function BoardSkeleton() {
  return (
    <div
      aria-busy
      aria-label="Loading tasks"
      className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2"
    >
      {BOARD_STATUSES.map((status) => (
        <div
          key={status}
          className={cn(
            'bg-muted/30 border-border flex min-h-32 flex-col gap-2 rounded-md border border-t-4 p-2',
            BOARD_COLUMN_BORDER[status],
          )}
        >
          <div className="bg-muted h-3 w-24 animate-pulse rounded" />
          <div className="bg-muted h-16 animate-pulse rounded-md" />
          <div className="bg-muted h-16 animate-pulse rounded-md" />
        </div>
      ))}
    </div>
  );
}

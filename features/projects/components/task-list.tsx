// features/projects/components/task-list.tsx — PUL-410 Stage 2, §14.3.4 / §16.10
//
// The List tab: a collapsible Month → Category → Task → Subtask tree over the filter bar's rows.
//
// **A presentation, like the Board — it never fetches the task set.** It draws the same `tasks`
// array the Board gets, so switching tabs costs no read and cannot show a different set
// (PUL-408.3). Every write it triggers — an inline status change, a Task Detail edit,
// `+ Add task in {Category}` — ends in `onChanged()`, which bumps the filter bar's `taskNonce`
// and re-reads list + header.
//
// PUL-421 adds `+ Add task` on each Month header (MGR only, the same gate): the same New Task
// modal with Month prefilled and Category suggesting that month's categories. After a create the
// new task's month and category groups are forced open, and `onTaskCreated` lets the pane widen
// its Month filter if the task landed outside it.
//
// The one read of its own is a task's subtask rows, fetched through `loadTaskDetail` only when
// that task is expanded. `FilteredTaskRow` stays a list shape (it carries counts, not rows), and
// tasks start collapsed, so an unexpanded list costs nothing extra.
//
// Grouping and collapse state are pure helpers in display.ts (`groupTaskTree`, `treeOpenState`),
// unit-tested in `features/projects/list.test.ts`.

'use client';

import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { dhakaToday, fmtDate, fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';
import { initials } from '@/features/employees/display';
import { loadTaskDetail } from '../actions';
import {
  PRIORITY_LABELS,
  PRIORITY_PILL_CLASSNAME,
  categoryDotClass,
  categoryKey,
  groupTaskTree,
  monthLabel,
  monthKey,
  retainerMonth,
  taskKey,
  treeOpenState,
  type StatusMenuViewer,
} from '../display';
import { NewTaskModal, type CreatedTaskPlacement } from './new-task-modal';
import { TaskDetailModal } from './task-detail-modal';
import { TaskStatusControl } from './task-status-control';
import type { DetailChildRow, FilteredTaskRow } from '../queries';

/**
 * §14.3.4's seven columns: Task · Assignee · Status · Due · Priority · Est · ⋯. One template
 * shared by the header row, every task row and every subtask row, so the columns cannot drift
 * out of line. (§14.3.4 names the second column "Owner"; the UI says "Assignee", the word the
 * filter bar and Task Detail already use.)
 */
const ROW_GRID =
  'grid grid-cols-[minmax(12rem,2fr)_minmax(9rem,1fr)_9.5rem_minmax(9rem,1fr)_5rem_4rem_2rem] items-center gap-3';

export function TaskList({
  tasks,
  loading,
  viewer,
  project,
  canCreateTask,
  onChanged,
  onTaskCreated,
}: {
  /** The filter bar's current `getFilteredTasks` result — the list never fetches its own. */
  tasks: FilteredTaskRow[];
  /** True while the filter bar is re-reading. */
  loading: boolean;
  /** Who is looking — drives each row's §14.3.2 status option set. */
  viewer: StatusMenuViewer;
  /**
   * The ONE selected project, or `null` for All projects. Month labels and the "Current cycle"
   * pill are anchored to a project's start date, so across several projects they have no single
   * meaning — the tree falls back to bare `Month N` with no pill, and `+ Add task` hides (no
   * project to add to). Same rule as the filter bar's Month ▾.
   */
  project: { id: string; startDate: string } | null;
  /** `can(viewer, 'project_task.create')`, decided server-side (§9.6 — MGR only). */
  canCreateTask: boolean;
  /** After any write from the list: an inline status change, a modal close. */
  onChanged: () => void;
  /**
   * After a task is created from the list, with where it landed. Replaces `onChanged` for that
   * write, so the pane can refetch AND widen its Month filter in one step.
   */
  onTaskCreated: (placement: CreatedTaskPlacement) => void;
}) {
  /**
   * **The collapse state — §16.10.** ONE object, declared with a real value (`{}`) from the first
   * render, holding only what the user has toggled. `treeOpenState` resolves it against the
   * current tree into a COMPLETE map every render — every key present, each the user's choice or
   * its default — so no code path ever meets a missing key or lazily creates one (§14.16's
   * "months disappeared" bug). Keys are structural (`month:3/category:SEO`, `task:<id>`), so a
   * toggle survives a refetch; the parent re-keys this component per project, so it resets on
   * switch.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  /** Which task's detail modal is open. `null` IS the closed state — one value, no drift. */
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /**
   * What the New Task modal was opened from: a category group (`+ Add task in {Category}`,
   * category only, as before) or a Month header (`+ Add task`, month only, PUL-421). `null` IS
   * the closed state.
   */
  const [adding, setAdding] = useState<{ category?: string; month?: number | null } | null>(null);
  /**
   * Bumped whenever the Task Detail modal closes. Subtasks are edited in the modal, and an edit
   * that renames one leaves the parent's done/total counts unchanged, so the counts alone cannot
   * tell an expanded task its rows are stale. Part of each subtask block's remount key.
   */
  const [subtaskNonce, setSubtaskNonce] = useState(0);

  // One read per render, shared by every row and the current-month derivation (§16.6: the
  // clock port, via dhakaToday — never the browser's zone).
  const today = dhakaToday();
  const currentMonth = project === null ? null : retainerMonth(project.startDate, today);
  const addToProjectId = canCreateTask && project !== null ? project.id : null;

  if (loading && tasks.length === 0) return <ListSkeleton />;

  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-md border border-dashed p-10 text-center text-sm">
        No tasks match these filters.
      </div>
    );
  }

  const tree = groupTaskTree(tasks);
  const open = treeOpenState(tree, overrides);
  const unassignedCount = tasks.filter((t) => t.assignee === null).length;

  function toggle(key: string) {
    setOverrides((o) => ({ ...o, [key]: !open[key] }));
  }

  /** For Category's suggestions: the categories already in each month, as grouped above. */
  const categoriesByMonth = new Map(
    tree.map((m) => [m.month, m.categories.map((c) => c.category)]),
  );

  /** A created task's month and category groups open even if the user had collapsed them. */
  function onCreated(placement: CreatedTaskPlacement) {
    setOverrides((o) => ({
      ...o,
      [monthKey(placement.month)]: true,
      [categoryKey(placement.month, placement.category)]: true,
    }));
    onTaskCreated(placement);
  }

  return (
    <>
      <div
        aria-busy={loading}
        className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}
      >
        {/*
          An awareness cue only. Unassigned tasks stay IN the tree, in their month and category,
          with an "Unassigned" assignee badge — pulling them out would fragment the hierarchy the
          list exists to show. (The Board pins them because assigning is that view's action.)
        */}
        {unassignedCount > 0 ? (
          <p className="border-border bg-muted/40 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
            <span className="text-foreground font-medium">{unassignedCount} unassigned.</span> Open
            a task to assign it.
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <div className="min-w-[56rem] space-y-2">
            <div
              className={cn(
                ROW_GRID,
                'text-muted-foreground px-3 text-[0.625rem] font-medium tracking-wide uppercase',
              )}
            >
              <span>Task</span>
              <span>Assignee</span>
              <span>Status</span>
              <span>Due</span>
              <span>Priority</span>
              <span>Est</span>
              <span className="sr-only">Actions</span>
            </div>

            {tree.map((m) => (
              <section key={m.key} className="border-border overflow-hidden rounded-md border">
                <GroupHeader
                  depth={0}
                  expanded={open[m.key] ?? true}
                  onToggle={() => toggle(m.key)}
                  className="py-2 text-xs font-semibold"
                  // On the row, not the toggle, so the tint runs under the action too.
                  rowClassName="bg-muted/40"
                  action={
                    // PUL-421: MGR only, the same gate as `+ Add task in {Category}`. A sibling
                    // of the toggle, never inside it (a button cannot nest in a button).
                    addToProjectId !== null ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground my-1 shrink-0"
                        aria-label={`Add task in ${
                          m.month === null ? 'Unscheduled' : `Month ${m.month}`
                        }`}
                        onClick={() => setAdding({ month: m.month })}
                      >
                        <PlusIcon />
                        Add task
                      </Button>
                    ) : null
                  }
                >
                  <span>
                    {m.month === null
                      ? 'Unscheduled'
                      : project === null
                        ? `Month ${m.month}`
                        : monthLabel(project.startDate, m.month)}
                  </span>
                  <DoneCount done={m.done} total={m.total} />
                  {m.month !== null && m.month === currentMonth ? (
                    <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 text-[0.625rem] font-normal text-teal-700 dark:text-teal-300">
                      Current cycle
                    </span>
                  ) : null}
                </GroupHeader>

                {open[m.key] ? (
                  <div className="pb-1">
                    {m.categories.map((c) => (
                      <div key={c.key}>
                        <GroupHeader
                          depth={1}
                          expanded={open[c.key] ?? true}
                          onToggle={() => toggle(c.key)}
                          className="text-muted-foreground py-1.5 text-xs font-medium"
                        >
                          <span
                            aria-hidden="true"
                            className={cn('size-2 rounded-full', categoryDotClass(c.category))}
                          />
                          <span>{c.category}</span>
                          <DoneCount done={c.done} total={c.total} />
                        </GroupHeader>

                        {open[c.key] ? (
                          <div>
                            {c.tasks.map((task) => {
                              const key = taskKey(task.id);
                              const expanded = open[key] ?? false;
                              return (
                                <div key={task.id}>
                                  <TaskRow
                                    task={task}
                                    viewer={viewer}
                                    expanded={task.subtaskTotal > 0 ? expanded : null}
                                    onToggle={() => toggle(key)}
                                    onOpen={() => setOpenTaskId(task.id)}
                                    onChanged={onChanged}
                                  />
                                  {task.subtaskTotal > 0 && expanded ? (
                                    <SubtaskRows
                                      // Remount (and so re-read) when the counts move or the
                                      // modal closes: both can mean the rows changed.
                                      key={`${task.subtaskDone}/${task.subtaskTotal}/${subtaskNonce}`}
                                      taskId={task.id}
                                      taskTitle={task.title}
                                      onOpen={() => setOpenTaskId(task.id)}
                                    />
                                  ) : null}
                                </div>
                              );
                            })}
                            {/*
                              §14.3.4: at the bottom of each OPEN category group, MGR only. Opens
                              PUL-408's New Task modal with this category pre-filled (§14.3.8).
                            */}
                            {addToProjectId !== null ? (
                              <div className="flex items-stretch px-3">
                                <TreeGuides depth={2} />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground my-0.5"
                                  onClick={() => setAdding({ category: c.category })}
                                >
                                  <PlusIcon />
                                  Add task in {c.category}
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* One modal for the whole list; it stays mounted with the last id while animating out. */}
      <TaskDetailModal
        taskId={openTaskId ?? ''}
        open={openTaskId !== null}
        onClose={() => {
          setOpenTaskId(null);
          setSubtaskNonce((n) => n + 1);
          onChanged();
        }}
      />

      {addToProjectId !== null ? (
        <NewTaskModal
          // No `key` here: the modal already keys its body on project, category and month, so
          // opening from a different group re-seeds the pre-fill. An outer key would remount
          // the Dialog itself when `adding` clears, skipping its exit animation.
          projectId={addToProjectId}
          defaultCategory={adding?.category}
          defaultMonth={adding?.month}
          categoriesByMonth={categoriesByMonth}
          projectStartDate={project?.startDate}
          open={adding !== null}
          onOpenChange={(next) => {
            if (!next) setAdding(null);
          }}
          onCreated={onCreated}
        />
      ) : null}
    </>
  );
}

/**
 * The file-tree gutter: one 20px column per ancestor level, each carrying a vertical line under
 * that ancestor's chevron (7px = half the size-3.5 chevron). Rows have no vertical padding of
 * their own, so the lines of consecutive rows meet and read as one continuous guide.
 */
function TreeGuides({ depth }: { depth: number }) {
  if (depth === 0) return null;
  // Its own gapless flex box, so a parent's `gap-*` can never widen the 20px steps.
  return (
    <span aria-hidden="true" className="flex shrink-0 self-stretch">
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="relative w-5">
          <span className="bg-border absolute inset-y-0 left-[7px] w-px" />
        </span>
      ))}
    </span>
  );
}

/** Chevron that turns to point down when open. Decorative: the button around it says it all. */
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
    />
  );
}

/** A month or category header: guides, then chevron + contents, the whole row the toggle. */
function GroupHeader({
  depth,
  expanded,
  onToggle,
  className,
  rowClassName,
  action,
  children,
}: {
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  className: string;
  /** Classes for the whole row, the toggle and `action` together. */
  rowClassName?: string;
  /** A control after the toggle, outside it (PUL-421's Month `+ Add task`). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn('hover:bg-muted/60 flex items-stretch px-3 transition-colors', rowClassName)}
    >
      <TreeGuides depth={depth} />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'focus-visible:ring-ring flex flex-1 items-center gap-2 text-left focus-visible:ring-2 focus-visible:outline-none',
          className,
        )}
      >
        <Chevron expanded={expanded} />
        {children}
      </button>
      {action}
    </div>
  );
}

function DoneCount({ done, total }: { done: number; total: number }) {
  return (
    <span className="text-muted-foreground text-[0.625rem] font-normal tabular-nums">
      {done}/{total} done
    </span>
  );
}

/** One §14.3.4 row: Task · Assignee · Status · Due · Priority · Est · ⋯. */
function TaskRow({
  task,
  viewer,
  expanded,
  onToggle,
  onOpen,
  onChanged,
}: {
  task: FilteredTaskRow;
  viewer: StatusMenuViewer;
  /** Whether its subtasks are showing, or `null` when it has none (no chevron to draw). */
  expanded: boolean | null;
  onToggle: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  return (
    <div className={cn(ROW_GRID, 'hover:bg-muted/30 px-3 text-xs')}>
      <span className="flex min-w-0 self-stretch">
        <TreeGuides depth={2} />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {expanded !== null ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} subtasks for ${task.title}`}
              onClick={onToggle}
              className="focus-visible:ring-ring hover:bg-muted -ml-0.5 rounded p-0.5 focus-visible:ring-2 focus-visible:outline-none"
            >
              <Chevron expanded={expanded} />
            </button>
          ) : (
            // Keeps titles aligned whether or not the row has a chevron.
            <span aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          {/* §14.3.4: title click → Task Detail. */}
          <button
            type="button"
            onClick={onOpen}
            className="focus-visible:ring-ring min-w-0 truncate py-1.5 text-left hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {task.title}
          </button>
          {task.subtaskTotal > 0 ? (
            <span
              aria-label={`${task.subtaskDone} of ${task.subtaskTotal} subtasks done`}
              className="text-muted-foreground border-border shrink-0 rounded-full border px-1.5 text-[0.625rem] tabular-nums"
            >
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
          ) : null}
        </span>
      </span>

      {task.assignee ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar size="sm">
            {task.assignee.image ? <AvatarImage src={task.assignee.image} alt="" /> : null}
            <AvatarFallback>{initials(task.assignee.name)}</AvatarFallback>
          </Avatar>
          <span className="truncate">{task.assignee.name}</span>
        </span>
      ) : (
        <span>
          <span className="text-muted-foreground border-border rounded-full border border-dashed px-1.5 py-0.5 text-[0.625rem]">
            Unassigned
          </span>
        </span>
      )}

      {/*
        §14.3.4: "Status pill inline-editable per 14.3.2" — the SAME control as the Task Detail
        modal. Its writes carry this row's `version`; `onChanged` re-reads the list, which is
        what hands the next write a fresh version (a second change on a stale one would CONFLICT).
      */}
      <span>
        <TaskStatusControl
          task={{
            id: task.id,
            title: task.title,
            status: task.status,
            version: task.version,
            assigneeId: task.assignee?.id ?? null,
          }}
          viewer={viewer}
          dependencyBlocked={
            task.blockedByTitle !== null ? { title: task.blockedByTitle } : undefined
          }
          onChanged={onChanged}
        />
      </span>

      {/* Full date with year (§14.3.4). The subtask count moved to the badge by the title. */}
      <span>{fmtDate(task.dueDate) || <span className="text-muted-foreground">Not set</span>}</span>

      <span>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[0.625rem]',
            PRIORITY_PILL_CLASSNAME[task.priority],
          )}
        >
          {PRIORITY_LABELS[task.priority]}
        </span>
      </span>

      <span className="tabular-nums">{fmtHM(task.estimatedHours)}</span>

      {/*
        §14.3.4 names a ⋯ column but defines no row actions, so this offers exactly one — the
        same thing the title does. Anything more (reassign, delete, duplicate) would be an
        invented action; each belongs in the Task Detail modal, where its permission is checked.
      */}
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${task.title}`}>
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <MenuContent>
          <MenuItem onClick={onOpen}>Open details</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

/**
 * An expanded task's subtask rows, read on mount through `loadTaskDetail` (the modal's own read,
 * so no new endpoint). Mounted only while its task is expanded and re-keyed by the parent when
 * the rows may have changed, so mounting IS the reload and there is no reset path to get wrong.
 *
 * Display only. Subtasks are ticked in Task Detail, where §9.6 ⁷'s permission is checked; a row
 * click opens that modal. They never gate submission (§16.8), so nothing here implies they do.
 */
function SubtaskRows({
  taskId,
  taskTitle,
  onOpen,
}: {
  taskId: string;
  taskTitle: string;
  onOpen: () => void;
}) {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'failed' } | { phase: 'ready'; rows: DetailChildRow[] }
  >({ phase: 'loading' });

  useEffect(() => {
    // A stale response must not land after the task collapses or the block remounts.
    let current = true;
    void (async () => {
      const result = await loadTaskDetail({ taskId });
      if (!current) return;
      setState(
        result.ok && result.data !== null
          ? { phase: 'ready', rows: result.data.detail.subtasks }
          : { phase: 'failed' },
      );
    })();
    return () => {
      current = false;
    };
  }, [taskId]);

  if (state.phase !== 'ready') {
    return (
      <div className="flex items-stretch px-3 text-[11px]">
        <TreeGuides depth={3} />
        <span className="text-muted-foreground py-1.5">
          {state.phase === 'loading' ? 'Loading subtasks...' : 'Could not load subtasks.'}
        </span>
      </div>
    );
  }

  return (
    <div role="group" aria-label={`Subtasks of ${taskTitle}`}>
      {state.rows.map((s) => (
        <div key={s.id} className={cn(ROW_GRID, 'hover:bg-muted/30 px-3 text-[11px]')}>
          <span className="flex min-w-0 self-stretch">
            <TreeGuides depth={3} />
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {s.done ? (
                <CheckCircle2Icon aria-hidden="true" className="size-3.5 shrink-0 text-teal-600" />
              ) : (
                <CircleIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5 shrink-0"
                />
              )}
              <button
                type="button"
                onClick={onOpen}
                aria-label={`${s.text}, ${s.done ? 'done' : 'not done'}. Open ${taskTitle}`}
                className={cn(
                  'text-muted-foreground focus-visible:ring-ring min-w-0 truncate py-1 text-left hover:underline focus-visible:ring-2 focus-visible:outline-none',
                  s.done && 'line-through',
                )}
              >
                {s.text}
              </button>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows in the list's own geometry while the first read is in flight. */
function ListSkeleton() {
  return (
    <div aria-busy aria-label="Loading tasks" className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="border-border space-y-2 rounded-md border p-3">
          <div className="bg-muted h-3 w-40 animate-pulse rounded" />
          <div className="bg-muted h-6 animate-pulse rounded" />
          <div className="bg-muted h-6 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}

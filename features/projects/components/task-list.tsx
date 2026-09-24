// features/projects/components/task-list.tsx — PUL-410 Stage 2, §14.3.4 / §16.10
//
// The List tab: a collapsible Month → Category → Task tree over the filter bar's rows.
//
// **A presentation, like the Board — it never fetches.** It draws the same `tasks` array the
// Board gets, so switching tabs costs no read and cannot show a different set (PUL-408.3). Every
// write it triggers — an inline status change, a Task Detail edit, `+ Add task in {Category}` —
// ends in `onChanged()`, which bumps the filter bar's `taskNonce` and re-reads list + header.
//
// Grouping and collapse state are pure helpers in display.ts (`groupTaskTree`, `treeOpenState`),
// unit-tested in `features/projects/list.test.ts`.

'use client';

import { ChevronRightIcon, MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { dhakaToday, fmtDate, fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';
import { initials } from '@/features/employees/display';
import {
  PRIORITY_LABELS,
  PRIORITY_PILL_CLASSNAME,
  categoryDotClass,
  groupTaskTree,
  monthLabel,
  retainerMonth,
  treeOpenState,
  type StatusMenuViewer,
} from '../display';
import { NewTaskModal } from './new-task-modal';
import { TaskDetailModal } from './task-detail-modal';
import { TaskStatusControl } from './task-status-control';
import type { FilteredTaskRow } from '../queries';

/**
 * §14.3.4's seven columns: Task · Owner · Status · Due · Priority · Est · ⋯. One template shared
 * by the header row and every task row, so the columns cannot drift out of line.
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
  /** After any write from the list: an inline status change, a modal close, a created task. */
  onChanged: () => void;
}) {
  /**
   * **The collapse state — §16.10.** ONE object, declared with a real value (`{}`) from the first
   * render, holding only what the user has toggled. `treeOpenState` resolves it against the
   * current tree into a COMPLETE map every render — every key present, each the user's choice or
   * its default — so no code path ever meets a missing key or lazily creates one (§14.16's
   * "months disappeared" bug). Keys are structural (`month:3/category:SEO`), so a toggle
   * survives a refetch; the parent re-keys this component per project, so it resets on switch.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  /** Which task's detail modal is open. `null` IS the closed state — one value, no drift. */
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /** The category `+ Add task in {Category}` was clicked in. `null` IS the closed state. */
  const [addingCategory, setAddingCategory] = useState<string | null>(null);

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
  const open = treeOpenState(tree, overrides, currentMonth);
  const unassignedCount = tasks.filter((t) => t.assignee === null).length;

  function toggle(key: string) {
    setOverrides((o) => ({ ...o, [key]: !open[key] }));
  }

  return (
    <>
      <div
        aria-busy={loading}
        className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}
      >
        {/*
          An awareness cue only. Unassigned tasks stay IN the tree, in their month and category,
          with an "Unassigned" owner badge — pulling them out would fragment the hierarchy the
          list exists to show. (The Board pins them because assigning is that view's action.)
        */}
        {unassignedCount > 0 ? (
          <p className="border-border bg-muted/40 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
            <span className="text-foreground font-medium">{unassignedCount} unassigned</span>
            {' '}— open a task to assign it.
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
              <span>Owner</span>
              <span>Status</span>
              <span>Due</span>
              <span>Priority</span>
              <span>Est</span>
              <span className="sr-only">Actions</span>
            </div>

            {tree.map((m) => (
              <section key={m.key} className="border-border rounded-md border">
                <GroupHeader
                  expanded={open[m.key] ?? true}
                  onToggle={() => toggle(m.key)}
                  className="bg-muted/40 px-3 py-2 text-xs font-medium"
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
                    <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 text-[0.625rem] text-teal-700 dark:text-teal-300">
                      Current cycle
                    </span>
                  ) : null}
                </GroupHeader>

                {open[m.key] ? (
                  <div className="divide-border divide-y">
                    {m.categories.map((c) => (
                      <div key={c.key}>
                        <GroupHeader
                          expanded={open[c.key] ?? true}
                          onToggle={() => toggle(c.key)}
                          className="px-3 py-1.5 pl-7 text-xs"
                        >
                          <span
                            aria-hidden="true"
                            className={cn('size-2 rounded-full', categoryDotClass(c.category))}
                          />
                          <span className="font-medium">{c.category}</span>
                          <DoneCount done={c.done} total={c.total} />
                        </GroupHeader>

                        {open[c.key] ? (
                          <div className="pb-1">
                            {c.tasks.map((task) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                viewer={viewer}
                                onOpen={() => setOpenTaskId(task.id)}
                                onChanged={onChanged}
                              />
                            ))}
                            {/*
                              §14.3.4: at the bottom of each OPEN category group, MGR only. Opens
                              PUL-408's New Task modal with this category pre-filled (§14.3.8).
                            */}
                            {addToProjectId !== null ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground ml-10"
                                onClick={() => setAddingCategory(c.category)}
                              >
                                <PlusIcon />
                                Add task in {c.category}
                              </Button>
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
          onChanged();
        }}
      />

      {addToProjectId !== null ? (
        <NewTaskModal
          // No `key` here: the modal already keys its body on `projectId:defaultCategory`, so
          // opening from a different group re-seeds the pre-fill. An outer key would remount
          // the Dialog itself when `addingCategory` clears, skipping its exit animation.
          projectId={addToProjectId}
          defaultCategory={addingCategory ?? undefined}
          open={addingCategory !== null}
          onOpenChange={(next) => {
            if (!next) setAddingCategory(null);
          }}
          onCreated={onChanged}
        />
      ) : null}
    </>
  );
}

/** A month or category header: chevron + contents, the whole row the toggle. */
function GroupHeader({
  expanded,
  onToggle,
  className,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        'hover:bg-muted/60 flex w-full items-center gap-2 text-left transition-colors',
        className,
      )}
    >
      <ChevronRightIcon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-90')}
      />
      {children}
    </button>
  );
}

function DoneCount({ done, total }: { done: number; total: number }) {
  return (
    <span className="text-muted-foreground text-[0.625rem] font-normal tabular-nums">
      {done}/{total} done
    </span>
  );
}

/** One §14.3.4 row: Task · Owner · Status · Due · Priority · Est · ⋯. */
function TaskRow({
  task,
  viewer,
  onOpen,
  onChanged,
}: {
  task: FilteredTaskRow;
  viewer: StatusMenuViewer;
  onOpen: () => void;
  onChanged: () => void;
}) {
  return (
    <div className={cn(ROW_GRID, 'hover:bg-muted/30 px-3 py-1.5 pl-10 text-xs')}>
      {/* §14.3.4: title click → Task Detail. */}
      <button
        type="button"
        onClick={onOpen}
        className="focus-visible:ring-ring truncate text-left font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {task.title}
      </button>

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

      {/* Full date with year PLUS the relative suffix (§14.3.4 — unlike the Board card). */}
      <span className="flex flex-col">
        <span>{fmtDate(task.dueDate) || <span className="text-muted-foreground">—</span>}</span>
        {task.subtaskTotal > 0 ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {task.subtaskDone}/{task.subtaskTotal} subtasks
          </span>
        ) : null}
      </span>

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

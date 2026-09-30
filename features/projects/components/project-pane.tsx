// features/projects/components/project-pane.tsx (PUL-408, reshaped by PUL-417.4, §14.3)
//
// The right pane when ONE project is selected in the workspace tree: the project header, the
// filter bar (Month ▾ · Assignee ▾ only, Amendment M), the tab strip and the active tab.
//
// Client ▾ and Project ▾ are gone: the tree is the only way to choose, and the URL holds the
// choice. The agency-wide Excel exports moved to the nothing-selected pane until PUL-418 scopes
// them to a client or an account on the overviews.
//
// Only the TASK list is fetched here (`loadFilteredTasks`), scoped to this project and the two
// filters. Board, List and Calendar all draw the same array, so "filter changes update every tab
// identically" (PUL-408.3) holds by construction and switching tabs never refetches. Review and
// Workload read their own queries, scoped to this project.

'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showErrorToast } from '@/lib/show-error-toast';
import { loadFilteredTasks } from '../actions';
import { monthLabel, PROJECT_TABS, type ProjectTabKey, type StatusMenuViewer } from '../display';
import type { FilteredTaskRow, TaskFilters } from '../queries';
import { ProjectHeader } from './project-header';
import { ReviewTab } from './review-tab';
import { TaskBoard } from './task-board';
import { TaskCalendar } from './task-calendar';
import { TaskList } from './task-list';
import { WorkloadTab } from './workload-tab';

/**
 * Only what Assignee ▾ draws. Not `PickableUser`: for an employee the page passes a one-item
 * list (themselves) built from the session, which has no `role` or `active` to give.
 */
interface AssigneeOption {
  id: string;
  name: string;
}

/**
 * The "no filter" sentinel for both dropdowns. Mirrors `FILTER_ALL` in queries.ts, which a
 * client file cannot import. It is part of the wire contract (`LoadFilteredTasksInput` accepts
 * it), so restating it is not a second source of truth.
 */
const ALL = 'all';
/** Assignee ▾'s claimable-work option. No user id can collide with it. */
const UNASSIGNED = 'unassigned';

/**
 * **The whole filter state, declared upfront (§16.10).** Every key exists from the first render,
 * so no path asks whether it is there yet (the prototype's lazy `if (!S.x)` initializers made
 * months vanish after re-renders, §14.16). Strings throughout, `month` included, because Base
 * UI's `Select` speaks strings: `toFilters` is the one conversion.
 */
interface FilterState {
  /** A stringified retainer month number, or `ALL`. */
  month: string;
  /**
   * The project this state was last reset for. Month ▾ only means something against one
   * project's start date, so when the URL moves to another project the month resets during
   * render (React's "adjusting state when a prop changes") rather than in an effect. Assignee is
   * kept: "my tasks" is meaningful across projects.
   */
  forProject: string;
  /** A user id, `UNASSIGNED`, or `ALL`. */
  assigneeId: string;
}

/** State → the wire shape. The single place a sentinel becomes a filter value. */
function toFilters(projectId: string, month: string, assigneeId: string): TaskFilters {
  return { projectId, month: month === ALL ? ALL : Number(month), assigneeId };
}

export function ProjectPane({
  project,
  months,
  assignees,
  canCreateTask,
  viewer,
  initialTasks,
  tab,
  onTab,
  onTreeStale,
}: {
  /** The selected project, from the tree. `startDate` anchors the Month labels. */
  project: { id: string; startDate: string };
  /** The retainer months this project's tasks use (`projectMonthsQuery`), for Month ▾. */
  months: number[];
  /** Already scoped to what this viewer may see: the page decides. */
  assignees: AssigneeOption[];
  /** `can(viewer, 'project_task.create')` from the page. Gates `+ Add task`; `createTask` re-checks. */
  canCreateTask: boolean;
  /** Who is looking (role re-read from the DB, §16.5). Feeds the List's status option sets. */
  viewer: StatusMenuViewer;
  /**
   * The server's first task list and the project it was read for. Used only when it matches
   * `project` (the page opened on this project); otherwise the pane starts empty and loading,
   * rather than flashing another project's rows.
   */
  initialTasks: { projectId: string; rows: FilteredTaskRow[] } | null;
  /** `?tab=`, already checked against the role (`parseProjectTab`). */
  tab: ProjectTabKey;
  /** The tab strip asks the workspace to move the URL. */
  onTab: (tab: ProjectTabKey) => void;
  /** After any mutation here, so the workspace re-reads the tree's counts. */
  onTreeStale: () => void;
}) {
  const [state, setState] = useState<FilterState>(() => ({
    month: ALL,
    forProject: project.id,
    assigneeId: ALL,
  }));

  if (state.forProject !== project.id) {
    setState((s) => ({ ...s, month: ALL, forProject: project.id }));
  }
  const month = state.forProject === project.id ? state.month : ALL;

  const seeded = initialTasks !== null && initialTasks.projectId === project.id;
  const [tasks, setTasks] = useState<FilteredTaskRow[]>(() => (seeded ? initialTasks.rows : []));
  const [loading, setLoading] = useState(!seeded);

  /**
   * The ONE refetch counter for the pane. Bumped after every mutation (New Task, archive, a
   * Task Detail edit, an inline status change); the header reads it as `refreshKey`, so the
   * header and the list move together. A counter, not a flag: two quick mutations must each
   * refetch.
   */
  const [taskNonce, setTaskNonce] = useState(0);

  function refresh() {
    setTaskNonce((n) => n + 1);
    onTreeStale();
  }

  /** The Review tab title's count (§14.3.5). `null` until that tab has loaded once. */
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  /**
   * Guards a slow response landing after a newer one: each run claims a token and only the
   * latest may write. The mount run re-reads what the server rendered; one redundant read,
   * accepted so there is a single fetch path.
   */
  const latestRequest = useRef(0);

  useEffect(() => {
    const token = ++latestRequest.current;

    void (async () => {
      // In the async body, not the effect body: a synchronous setState in an effect is a
      // cascading render (`react-hooks/set-state-in-effect`).
      setLoading(true);
      const result = await loadFilteredTasks(toFilters(project.id, month, state.assigneeId));
      if (token !== latestRequest.current) return;

      if (!result.ok) {
        showErrorToast(result);
        setLoading(false);
        return;
      }
      setTasks(result.data);
      setLoading(false);
    })();
  }, [project.id, month, state.assigneeId, taskNonce]);

  return (
    <div className="space-y-4">
      {/* Keyed by project so switching projects remounts it: mounting is the reset. */}
      <ProjectHeader
        key={project.id}
        projectId={project.id}
        refreshKey={taskNonce}
        onChanged={refresh}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={month}
          onValueChange={(v: string | null) => setState((s) => ({ ...s, month: v ?? ALL }))}
          disabled={months.length === 0}
        >
          <SelectTrigger aria-label="Month" className="w-48">
            {/*
              The children function is required: left bare, `Select.Value` renders the raw value
              because no `items` map is passed to the Root (the PUL-407 / PUL-206 trap).
            */}
            <SelectValue>
              {(v: string | null) =>
                v === null || v === ALL ? 'All months' : monthLabel(project.startDate, Number(v))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {monthLabel(project.startDate, m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={state.assigneeId}
          onValueChange={(v: string | null) => setState((s) => ({ ...s, assigneeId: v ?? ALL }))}
        >
          <SelectTrigger aria-label="Assignee" className="w-48">
            <SelectValue>
              {(v: string | null) => {
                if (v === null || v === ALL) return 'All assignees';
                if (v === UNASSIGNED) return 'Unassigned';
                return assignees.find((u) => u.id === v)?.name ?? 'All assignees';
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {assignees.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* §14.3's tabs, filtered to what this role may see (PROJECT_TABS). */}
      <div className="border-border flex gap-1 overflow-x-auto border-b">
        {PROJECT_TABS.filter((t) => t.visibleTo.includes(viewer.role)).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={
              tab === t.key
                ? 'border-primary text-foreground -mb-px shrink-0 border-b-2 px-3 py-2 text-xs font-medium'
                : 'text-muted-foreground hover:text-foreground -mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-xs'
            }
          >
            {t.label}
            {/* §14.3.5: "Tab title shows count", once the Review tab has loaded it. */}
            {t.key === 'review' && reviewCount !== null ? (
              <span className="text-muted-foreground ml-1 tabular-nums">({reviewCount})</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === 'board' ? (
        <TaskBoard
          tasks={tasks}
          loading={loading}
          addToProjectId={canCreateTask ? project.id : null}
          onTaskCreated={refresh}
          onTaskClosed={refresh}
        />
      ) : tab === 'list' ? (
        <TaskList
          // Collapse keys (`month:3`) are per project, so switching projects resets them.
          key={project.id}
          tasks={tasks}
          loading={loading}
          viewer={viewer}
          project={{ id: project.id, startDate: project.startDate }}
          canCreateTask={canCreateTask}
          onChanged={refresh}
        />
      ) : tab === 'calendar' ? (
        <TaskCalendar tasks={tasks} loading={loading} onChanged={refresh} />
      ) : tab === 'review' ? (
        <ReviewTab projectId={project.id} onCount={setReviewCount} onChanged={refresh} />
      ) : (
        <WorkloadTab projectId={project.id} />
      )}
    </div>
  );
}

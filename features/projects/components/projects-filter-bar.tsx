// features/projects/components/projects-filter-bar.tsx — PUL-408 Stage 1, §14.3 / §16.10
//
// The /projects filter bar: Client ▾ · Project ▾ (client-scoped) · Month ▾ · Assignee ▾, plus
// the MGR-only export slot, the Board/List/Calendar tab strip, and the active tab's panel.
//
// Every dropdown's whole option list arrives from the server component and the cascade runs in
// memory — the same reasoning as the employee grid (PUL-206) and the client list (PUL-207): the
// agency runs tens of projects, so one unfiltered fetch is smaller than the JS that would page
// it, and changing Client ▾ costs no round trip. Only the TASK list is refetched, because that
// is the one thing the filters actually narrow server-side.

'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { showErrorToast } from '@/lib/show-error-toast';
import { loadFilteredTasks } from '../actions';
import { monthLabel } from '../display';
import { ProjectHeader } from './project-header';
import { TaskBoard } from './task-board';
import type { PickableClient } from '../../clients/queries';
import type { FilteredTaskRow, PickableProject, ProjectMonths, TaskFilters } from '../queries';

/**
 * Only what the dropdown draws. Deliberately NOT `PickableUser`: the page passes a
 * single-element list for an employee (themselves) built from the session rather than a roster
 * read, and that has no `role` / `active` to give. Narrowing the prop to what is actually
 * rendered is what lets both callers satisfy it honestly.
 */
interface AssigneeOption {
  id: string;
  name: string;
}

/**
 * The "no filter" sentinel, shared by all four dropdowns. Mirrors `FILTER_ALL` in queries.ts,
 * which this file cannot import: queries.ts pulls in the db client and is server-only. The
 * string is part of the wire contract (`LoadFilteredTasksInput` accepts it), not an internal
 * detail, so restating it here does not create a second source of truth.
 */
const ALL = 'all';
/** Assignee ▾'s claimable-work option. No user id can collide with it. */
const UNASSIGNED = 'unassigned';

/** §14.3's tab strip. Review / Workload / Manager QA are PUL-412 and not offered yet. */
const TABS = [
  { key: 'board', label: 'Board' },
  { key: 'list', label: 'List' },
  { key: 'calendar', label: 'Calendar' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * **The whole filter state, declared upfront — §16.10.**
 *
 * This is the principle's exact shape: the prototype scattered `S.projFilter`, `S.projId` and
 * `S.projTab` as lazy `if (!S.x)` initializers, any path that ran first found `undefined`, and
 * months disappeared after re-renders (§14.16). Every key below exists from the first render
 * with a real value, so no code path anywhere has to ask whether a key is there yet.
 *
 * **Every field is a `string`, including `month`,** which is a number everywhere else in this
 * slice. That is deliberate: Base UI's `Select` speaks strings, so typing the state as strings
 * means there is exactly ONE conversion in the component — `toFilters` at the query boundary —
 * instead of a parse on every read and a stringify on every write. A number-typed `month` here
 * would put a `Number(...)` in each handler, which is the kind of scattered coercion that ends
 * up inconsistent.
 *
 * `tab` lives in the same object rather than its own `useState` because §16.10 is about the
 * state *schema* being in one declared place, and because it is the one key that deliberately
 * does NOT refetch: all three tabs read the same rows (§16.9 / PUL-408.3). Keeping it here is
 * what makes that visible — the fetch effect simply doesn't list it as a dependency.
 */
interface FilterState {
  /** A client id, or `ALL`. */
  clientId: string;
  /** A project id, or `ALL`. */
  projectId: string;
  /** A stringified retainer month number, or `ALL`. */
  month: string;
  /** A user id, `UNASSIGNED`, or `ALL`. */
  assigneeId: string;
  tab: TabKey;
}

const INITIAL_STATE: FilterState = {
  clientId: ALL,
  projectId: ALL,
  month: ALL,
  assigneeId: ALL,
  tab: 'board',
};

/** State → the wire shape. The single place a sentinel becomes an absent key. */
function toFilters(state: FilterState): TaskFilters {
  return {
    clientId: state.clientId === ALL ? undefined : state.clientId,
    projectId: state.projectId === ALL ? undefined : state.projectId,
    month: state.month === ALL ? ALL : Number(state.month),
    assigneeId: state.assigneeId,
  };
}

export function ProjectsFilterBar({
  clients,
  projects,
  projectMonths,
  assignees,
  canExport,
  canCreateTask,
  initialTasks,
}: {
  clients: PickableClient[];
  /** Every ACTIVE project, each carrying its `clientId` so Project ▾ can scope in memory. */
  projects: PickableProject[];
  projectMonths: ProjectMonths[];
  /** Already scoped to what this viewer may see — the page decides, not this component. */
  assignees: AssigneeOption[];
  /** MGR-only (§14.3). Controls whether the export slot renders at all. */
  canExport: boolean;
  /**
   * `can(viewer, 'project_task.create')`, decided server-side by the page (§9.6 — MGR only).
   * Gates the Board's `+ Add task`. Convenience, not security: `createTask` re-authorizes.
   */
  canCreateTask: boolean;
  /** The server's first result, so the page has rows before the client ever runs. */
  initialTasks: FilteredTaskRow[];
}) {
  const [state, setState] = useState<FilterState>(INITIAL_STATE);
  const [tasks, setTasks] = useState<FilteredTaskRow[]>(initialTasks);
  const [loading, setLoading] = useState(false);

  /**
   * The cascade, as three functions rather than one generic setter.
   *
   * Choosing a client RESETS project and month; choosing a project RESETS month. Without that,
   * picking Client A → Project A1 → Month 3 and then switching to Client B leaves `projectId`
   * pointing at a project client B does not own, and the task list silently returns nothing
   * that matches. Resetting downstream keys is the cascade.
   */
  function pickClient(clientId: string) {
    setState((s) => ({ ...s, clientId, projectId: ALL, month: ALL }));
  }

  function pickProject(projectId: string) {
    setState((s) => ({ ...s, projectId, month: ALL }));
  }

  // Project ▾ shows only the selected client's projects; Month ▾ only exists once a single
  // project is chosen, because "Month 3" means nothing across two projects with different
  // start dates.
  const scopedProjects =
    state.clientId === ALL ? projects : projects.filter((p) => p.clientId === state.clientId);

  const selectedProject =
    state.projectId === ALL ? null : (projects.find((p) => p.id === state.projectId) ?? null);

  const monthsForProject =
    selectedProject === null
      ? []
      : (projectMonths.find((m) => m.projectId === selectedProject.id)?.months ?? []);

  /**
   * Refetch the task list whenever a FILTER changes — `state.tab` is deliberately absent from
   * the dependency list (all three tabs read the same rows, PUL-408.3).
   *
   * The ref guards a slow response from an earlier filter landing after a newer one: click
   * through three clients quickly and the responses can arrive out of order, leaving the list
   * showing client 1's tasks under client 3's filters. Each run claims a token and only the
   * current claimant is allowed to write.
   *
   * This does run once on mount and refetch what the server already rendered. That is one
   * redundant read on first paint, accepted so there is a single fetch path instead of a
   * "have I fetched yet" flag — which is the §16.10 lazy-init branch wearing a different hat.
   */
  const latestRequest = useRef(0);

  /**
   * Bumped by the project header after New Task / Archive, to re-read the task list.
   *
   * A counter rather than a boolean, for the same reason as the header's own nonce: two
   * mutations in quick succession must each trigger a fetch, and a flag already `true` would
   * swallow the second. It sits alongside the filters in the effect's dependency list, so a
   * mutation and a filter change take exactly the same refetch path.
   */
  const [taskNonce, setTaskNonce] = useState(0);

  useEffect(() => {
    const token = ++latestRequest.current;

    void (async () => {
      // Inside the async body, not the effect body: a synchronous setState in an effect is a
      // cascading render (`react-hooks/set-state-in-effect`, correctly). Here it lands in a
      // microtask, after the render that scheduled the effect has committed.
      setLoading(true);
      const result = await loadFilteredTasks(toFilters(state));
      if (token !== latestRequest.current) return; // a newer filter has already won

      if (!result.ok) {
        showErrorToast(result);
        setLoading(false);
        return;
      }
      setTasks(result.data);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `state.tab` must NOT refetch.
  }, [state.clientId, state.projectId, state.month, state.assigneeId, taskNonce]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={state.clientId} onValueChange={(v: string | null) => pickClient(v ?? ALL)}>
          <SelectTrigger aria-label="Client" className="w-44">
            {/*
              The children FUNCTION is required, not decoration. Left bare, `Select.Value`
              resolves its label through `String(value)` — the raw id — because no `items` map
              is passed to the Root. Same trap and same fix as the Task Detail Assign ▾
              (PUL-407) and the offboarding pickers (PUL-206).
            */}
            <SelectValue>
              {(v: string | null) =>
                v === null || v === ALL
                  ? 'All clients'
                  : (clients.find((c) => c.id === v)?.name ?? 'All clients')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={state.projectId} onValueChange={(v: string | null) => pickProject(v ?? ALL)}>
          <SelectTrigger aria-label="Project" className="w-52">
            <SelectValue>
              {(v: string | null) =>
                v === null || v === ALL
                  ? 'All projects'
                  : (projects.find((p) => p.id === v)?.name ?? 'All projects')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {scopedProjects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={state.month}
          onValueChange={(v: string | null) => setState((s) => ({ ...s, month: v ?? ALL }))}
          // "Month 3" is only meaningful against one project's start date, so the control is
          // inert until a project is chosen — and inert with a reason the user can read.
          disabled={selectedProject === null || monthsForProject.length === 0}
        >
          <SelectTrigger aria-label="Month" className="w-48">
            <SelectValue>
              {(v: string | null) =>
                v === null || v === ALL || selectedProject === null
                  ? 'All months'
                  : monthLabel(selectedProject.startDate, Number(v))
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All months</SelectItem>
            {selectedProject !== null &&
              monthsForProject.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {monthLabel(selectedProject.startDate, m)}
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

        {/*
          §14.3's export slot — MGR only. Rendered but INERT: the server-side XLSX is PUL-413
          (§13.8 `exportClientTasks`), which owns both the route and the client-safe column
          rules. The slot exists here so 413 is a wiring change, not a layout change.
        */}
        {canExport ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled title="Exports land in PUL-413">
              Weekly (Excel)
            </Button>
            <Button variant="outline" size="sm" disabled title="Exports land in PUL-413">
              Monthly (Excel)
            </Button>
          </div>
        ) : null}
      </div>

      {/*
        §14.3's project header — only when ONE project is selected.

        The breadcrumb is `Client › Project · type · Month N`, and none of those four parts has
        a meaning across a mixed set: two projects have two start dates, so "Month N" is not one
        number, and progress would be an average of unrelated engagements. Rather than render a
        header full of em dashes, the bar says what to do to get one. Keyed by project id so
        switching projects remounts it — mounting is the reset, same rule as the modals.
      */}
      {selectedProject === null ? (
        <p className="text-muted-foreground text-xs">
          Select a project to see its progress, health and task actions.
        </p>
      ) : (
        <ProjectHeader
          key={selectedProject.id}
          projectId={selectedProject.id}
          // The page's one refetch counter: a Task Detail edit on the Board reloads the header
          // too, so progress and health move with the card (PUL-409 Stage 2).
          refreshKey={taskNonce}
          onChanged={() => setTaskNonce((n) => n + 1)}
        />
      )}

      {/* §14.3's tabs. Board / List / Calendar are PUL-409 / 410 / 411; Review, Workload and
          Manager QA (PUL-412) are not offered until their queries exist. */}
      <div className="border-border flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setState((s) => ({ ...s, tab: tab.key }))}
            className={
              state.tab === tab.key
                ? 'border-primary text-foreground -mb-px border-b-2 px-3 py-2 text-xs font-medium'
                : 'text-muted-foreground hover:text-foreground -mb-px border-b-2 border-transparent px-3 py-2 text-xs'
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/*
        The active tab's panel. Every view receives the SAME `tasks` array — none of them
        fetches — which is what makes "filter changes update every tab identically"
        (PUL-408.3) true by construction. List (PUL-410) and Calendar (PUL-411) slot in as
        sibling branches here, each fed `tasks` / `loading` / the same nonce bump.
      */}
      {state.tab === 'board' ? (
        <TaskBoard
          tasks={tasks}
          loading={loading}
          // `+ Add task` needs ONE project to add to — with "All projects" there is none, so the
          // board is handed null and the button does not render.
          addToProjectId={canCreateTask && selectedProject !== null ? selectedProject.id : null}
          // After a task is created from the board, re-read list + header together.
          onTaskCreated={() => setTaskNonce((n) => n + 1)}
          // Re-read after the Task Detail modal closes, through the same nonce New Task and
          // Archive use — a status or assignee change made in the modal moves the card.
          onTaskClosed={() => setTaskNonce((n) => n + 1)}
        />
      ) : (
        <div className="text-muted-foreground border-border rounded-md border border-dashed p-6 text-xs">
          {state.tab === 'list' ? 'List view lands in PUL-410.' : 'Calendar view lands in PUL-411.'}
        </div>
      )}
    </div>
  );
}

// app/(app)/projects/page.tsx — PUL-408 Stage 1, §14.3
//
// Replaces the PUL-110.4 placeholder. This stage ships the filter bar and the page shell only:
// the project header (PUL-408.2) and the Board / List / Calendar views (PUL-409 / 410 / 411)
// are still to come, and the New Task modal is PUL-408's second stage.
//
// Every dropdown's options are fetched here, server-side, and handed down whole — the cascade
// runs in memory in the client component. The task list is the one thing the filters narrow on
// the server, and it is re-read through `loadFilteredTasks` as they change.

import { activeClientsQuery } from '@/features/clients/queries';
import { assignableUsersQuery } from '@/features/employees/queries';
import { ProjectsFilterBar } from '@/features/projects/components/projects-filter-bar';
import {
  activeProjectsQuery,
  getFilteredTasks,
  projectMonthsQuery,
} from '@/features/projects/queries';
import { isManagerRole } from '@/features/projects/display';
import { can } from '@/lib/authz';
import { requireRouteAccess } from '@/lib/route-guard';

/** The tabs `?tab=` may open. Review / Workload stay click-only (they are role-gated). */
const LINKABLE_TABS = ['board', 'list', 'calendar'] as const;
type LinkableTab = (typeof LINKABLE_TABS)[number];

export default async function ProjectsPage({
  searchParams,
}: {
  /**
   * `?project=<id>&tab=list` opens one project, on one tab, with the month filter cleared: the
   * Start Project wizard's landing (§14.3.8, PUL-506). An unknown or archived project id is
   * ignored and the page opens unfiltered.
   */
  searchParams: Promise<{ project?: string; tab?: string }>;
}) {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  const viewer = await requireRouteAccess('/projects');
  const params = await searchParams;

  /**
   * Who may appear in Assignee ▾.
   *
   * `assignableUsersQuery` rather than `activeUsersQuery`: it is active users MINUS
   * `super_admin`, which is exactly the set that can hold a task (Amendment E / the
   * `pt_no_sa_assignee` trigger). Offering the SA here would be an option that can never match
   * a row.
   *
   * **Employees see only themselves** in this dropdown — but note what that is and is not.
   * §1–§8 line 208 states the rule; §14.3 does not restate it, and §13.8 is explicit that
   * project reads are an OPEN model ("all roles read all active projects"). Per CLAUDE.md's
   * precedence (§9–§17 over §1–§8) this is therefore scoped as a PICKER convenience only —
   * an employee filtering to "me" is the common case and a roster they cannot act on is noise
   * — and NOT as a scope on `getFilteredTasks`, which stays open. Making it a real scope would
   * contradict §13.8 and should be a PRD amendment, not a quiet implementation choice.
   */
  const assignees = isManagerRole(viewer.role)
    ? await assignableUsersQuery()
    : [{ id: viewer.id, name: viewer.name, image: viewer.image ?? null }];

  // Independent of each other — fetched concurrently.
  const [clients, projects, projectMonths] = await Promise.all([
    activeClientsQuery(),
    activeProjectsQuery(),
    projectMonthsQuery(),
  ]);

  const linked = params.project ? projects.find((p) => p.id === params.project) : undefined;
  const initialView = linked
    ? {
        clientId: linked.clientId,
        projectId: linked.id,
        tab: LINKABLE_TABS.includes(params.tab as LinkableTab)
          ? (params.tab as LinkableTab)
          : 'board',
      }
    : null;

  // The first page, so the shell renders with real rows instead of a spinner: unfiltered, or the
  // linked project's tasks when the page was opened on one.
  const initialTasks = await getFilteredTasks(initialView ? { projectId: initialView.projectId } : {});

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-lg font-semibold">Projects</h1>

      <ProjectsFilterBar
        clients={clients}
        projects={projects}
        projectMonths={projectMonths}
        assignees={assignees}
        // §14.3: the Excel exports are MGR-only. admin_hr is manager-level for people ops but
        // is not a delivery manager, and `isManagerRole` is the §9.6 delivery set.
        canExport={isManagerRole(viewer.role)}
        // The Board's `+ Add task` (PUL-409). Read off the §9.6 table rather than restated —
        // the same `can()` call `loadProjectHeader` makes for the header's `+ New Task`.
        canCreateTask={can(viewer, 'project_task.create')}
        // The List view's inline status control needs to know who is looking (§14.3.2). Only
        // `{ id, role }` crosses to the client — not the whole session user.
        viewer={{ id: viewer.id, role: viewer.role }}
        initialTasks={initialTasks}
        initialView={initialView}
      />
    </div>
  );
}

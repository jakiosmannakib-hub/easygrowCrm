// app/(app)/projects/page.tsx (PUL-408, reshaped by PUL-417 into the §14.3 workspace)
//
// The Client › Account › Project tree on the left, the selected node on the right. Everything
// the client needs arrives from here whole: the tree (`getWorkspaceTree`), every dropdown's
// options, the viewer's ⋯ menu flags (computed with `can()`), and the first task list for the
// selection the URL names. From then on the selection lives in the URL and the task list is
// re-read through `loadFilteredTasks`.

import {
  accountsListQuery,
  activeClientsQuery,
  clientsListQuery,
} from '@/features/clients/queries';
import { assignableUsersQuery } from '@/features/employees/queries';
import { workspaceMenuFlags } from '@/features/projects/capabilities';
import { ProjectsWorkspace } from '@/features/projects/components/projects-workspace';
import { isManagerRole } from '@/features/projects/display';
import {
  activeProjectsQuery,
  getFilteredTasks,
  getWorkspaceTree,
  projectMonthsQuery,
} from '@/features/projects/queries';
import { resolveSelection, selectionFilters } from '@/features/projects/workspace-tree';
import { can } from '@/lib/authz';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function ProjectsPage({
  searchParams,
}: {
  /**
   * §14.3: the URL is the selection, `?client=&account=&project=&tab=`. `?project=` alone (the
   * Start Project landing, §14.3.8) derives its account and client; unknown, archived or
   * mismatched ids are ignored rather than trusted (`resolveSelection`).
   */
  searchParams: Promise<{ client?: string; account?: string; project?: string; tab?: string }>;
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

  /**
   * The ⋯ menu's §9.6 cells (§14.3: "each item shown only when the viewer's role allows it").
   * Decided here on the DB-read role; hiding is presentation, every action re-authorizes.
   */
  const flags = workspaceMenuFlags(viewer);
  // The reused client and account dialogs need full rows. Only read when some menu item can use
  // them, so an employee's page does not carry every client's contact and notes for nothing.
  const managesClientsOrAccounts =
    flags.clientUpdate ||
    flags.clientArchive ||
    flags.accountCreate ||
    flags.accountUpdate ||
    flags.accountArchive ||
    flags.projectCreate;

  // Independent of each other — fetched concurrently.
  const [tree, clients, projects, projectMonths, clientRows, accountRows] = await Promise.all([
    getWorkspaceTree(),
    activeClientsQuery(),
    activeProjectsQuery(),
    projectMonthsQuery(),
    managesClientsOrAccounts ? clientsListQuery() : Promise.resolve([]),
    managesClientsOrAccounts ? accountsListQuery() : Promise.resolve([]),
  ]);

  // The same resolution the client makes from `useSearchParams`, so the first task list matches
  // the selection the page opens on. Month and Assignee start at All ("month filter cleared",
  // §14.3.8).
  const selection = resolveSelection(tree, params);
  const initialTasks = await getFilteredTasks(selectionFilters(selection));

  return (
    <ProjectsWorkspace
      tree={tree}
      flags={flags}
      clientRows={clientRows}
      accountRows={accountRows}
      clients={clients}
      projects={projects}
      projectMonths={projectMonths}
      assignees={assignees}
      // §14.3: the Excel exports are MGR-only. admin_hr is manager-level for people ops but
      // is not a delivery manager, and `isManagerRole` is the §9.6 delivery set.
      canExport={isManagerRole(viewer.role)}
      // The Board's `+ Add task` (PUL-409). Read off the §9.6 table rather than restated:
      // the same `can()` call `loadProjectHeader` makes for the header's `+ New Task`.
      canCreateTask={can(viewer, 'project_task.create')}
      // The List view's inline status control needs to know who is looking (§14.3.2). Only
      // `{ id, role }` crosses to the client, not the whole session user.
      viewer={{ id: viewer.id, role: viewer.role }}
      initialTasks={initialTasks}
    />
  );
}

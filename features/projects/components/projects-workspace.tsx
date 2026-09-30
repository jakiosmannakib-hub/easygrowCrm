// features/projects/components/projects-workspace.tsx (PUL-417, §14.3 Amendment M)
//
// /projects as a two-pane workspace: the Client › Account › Project tree on the left, the
// selected node on the right. At phone width the tree moves into a drawer.
//
// The right pane follows the selection (417.3 / 417.4):
//   - a project  → `ProjectPane`: header, Month ▾ · Assignee ▾, and the five tabs;
//   - an account → `AccountOverview`: its projects with progress and health;
//   - a client   → `ClientOverview`: one card per account;
//   - nothing    → `AgencyPane`: the agency-wide Review and Workload tabs.
//
// ── The URL is the selection (417.5) ────────────────────────────────────────────────────
// `/projects?client=…&account=…&project=…&tab=…`, read with `useSearchParams` and resolved
// against the tree by `resolveSelection`: `?project=` alone (the Start Project landing) derives
// its account and client, and ids not in the tree are ignored. A new node is a
// `history.pushState` (a tab change replaces instead), which Next.js syncs into
// `useSearchParams` without a server round trip, so Back and Forward walk the selection. After
// a mutation `router.refresh()` re-reads the tree; a node that disappeared (archived) falls
// back to its parent on its own.
//
// ── Start from template (417.6) ─────────────────────────────────────────────────────────
// An account's ⋯ "Start from template" opens ONE `StartProjectDialog` hosted here, with that
// client and account prefilled and the template picked in its step 0. Its client and account
// options come from the tree, which already holds exactly the live ones.

'use client';

import { FolderTreeIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { AccountRow, ClientRow } from '@/features/clients/queries';
import { StartProjectDialog } from '@/features/templates/components/start-project-wizard';
import type { StartProjectTemplate } from '@/features/templates/start-project';
import { parseAgencyTab, parseProjectTab, type StatusMenuViewer } from '../display';
import type { FilteredTaskRow, ProjectMonths } from '../queries';
import {
  resolveSelection,
  selectedNodes,
  selectionHref,
  type WorkspaceMenuFlags,
  type WorkspaceSelection,
  type WorkspaceTree,
} from '../workspace-tree';
import { ProjectPane } from './project-pane';
import { WorkspaceTreePanel } from './workspace-tree-panel';
import { AccountOverview, AgencyPane, ClientOverview } from './workspace-overviews';

const NOTHING: WorkspaceSelection = { client: null, account: null, project: null };

export function ProjectsWorkspace({
  tree,
  flags,
  clientRows,
  accountRows,
  projectMonths,
  assignees,
  canCreateTask,
  canExport,
  viewer,
  initialTasks,
  startProject,
}: {
  /** Live nodes only (`getWorkspaceTree()`); it is also what the URL resolves against. */
  tree: WorkspaceTree;
  flags: WorkspaceMenuFlags;
  clientRows: ClientRow[];
  accountRows: AccountRow[];
  projectMonths: ProjectMonths[];
  assignees: { id: string; name: string }[];
  canCreateTask: boolean;
  /** MGR only (§14.3): the agency-wide exports on the nothing-selected pane. */
  canExport: boolean;
  viewer: StatusMenuViewer;
  /** The server's first task list, when the page opened on a project. */
  initialTasks: { projectId: string; rows: FilteredTaskRow[] } | null;
  /** The wizard's data, or null when the viewer cannot start from a template. */
  startProject: {
    templates: StartProjectTemplate[];
    assignees: { id: string; name: string }[];
    canCreateAccount: boolean;
  } | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** The client and account the wizard opens on, or null while it is closed. */
  const [wizardFor, setWizardFor] = useState<{ clientId: string; accountId: string } | null>(null);

  const selection = useMemo(
    () =>
      resolveSelection(tree, {
        client: params.get('client'),
        account: params.get('account'),
        project: params.get('project'),
      }),
    [tree, params],
  );
  const rawTab = params.get('tab');
  const nodes = selectedNodes(tree, selection);

  const clientsById = useMemo(() => new Map(clientRows.map((c) => [c.id, c])), [clientRows]);
  const accountsById = useMemo(() => new Map(accountRows.map((a) => [a.id, a])), [accountRows]);

  // The wizard's pickers, straight from the live tree.
  const wizardClients = useMemo(() => tree.map((c) => ({ id: c.id, name: c.name })), [tree]);
  const wizardAccounts = useMemo(
    () => tree.flatMap((c) => c.accounts.map((a) => ({ id: a.id, clientId: c.id, name: a.name }))),
    [tree],
  );

  function navigate(next: WorkspaceSelection, nextTab: string) {
    const href = selectionHref(next, nextTab);
    const sameNode =
      next.client === selection.client &&
      next.account === selection.account &&
      next.project === selection.project;
    // A tab switch is not a new place to go Back to; a new node is.
    if (sameNode) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
  }

  function selectFromTree(next: WorkspaceSelection) {
    // The tab rides along; each pane re-validates it for its own tab set and role.
    navigate(next, rawTab ?? 'board');
    setDrawerOpen(false);
  }

  const refreshTree = () => router.refresh();

  const panel = (
    <WorkspaceTreePanel
      tree={tree}
      selection={selection}
      onSelect={selectFromTree}
      onStartFromTemplate={(prefill) => {
        setDrawerOpen(false);
        setWizardFor(prefill);
      }}
      flags={flags}
      clientRows={clientsById}
      accountRows={accountsById}
    />
  );

  let pane: React.ReactNode;
  if (nodes.project) {
    const project = nodes.project;
    pane = (
      <ProjectPane
        project={{ id: project.id, startDate: project.startDate }}
        months={projectMonths.find((m) => m.projectId === project.id)?.months ?? []}
        assignees={assignees}
        canCreateTask={canCreateTask}
        viewer={viewer}
        initialTasks={initialTasks}
        tab={parseProjectTab(rawTab, viewer.role)}
        onTab={(tab) => navigate(selection, tab)}
        onTreeStale={refreshTree}
      />
    );
  } else if (nodes.client && nodes.account) {
    pane = (
      <AccountOverview client={nodes.client} account={nodes.account} onSelect={selectFromTree} />
    );
  } else if (nodes.client) {
    pane = <ClientOverview client={nodes.client} onSelect={selectFromTree} />;
  } else {
    pane = (
      <AgencyPane
        tab={parseAgencyTab(rawTab, viewer.role)}
        canExport={canExport}
        onTab={(tab) => navigate(NOTHING, tab)}
        onTreeStale={refreshTree}
      />
    );
  }

  const selectionLabel =
    nodes.project?.name ?? nodes.account?.name ?? nodes.client?.name ?? 'All clients';

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop: the tree is a sticky column. Hidden below md, where the drawer takes over. */}
      <aside className="hidden md:sticky md:top-0 md:block md:max-h-[calc(100dvh-7rem)] md:self-start md:overflow-y-auto md:border-r md:pr-3">
        {panel}
      </aside>

      <div className="min-w-0 space-y-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Projects</h1>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto max-w-[60%] md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <FolderTreeIcon />
            <span className="truncate">{selectionLabel}</span>
          </Button>
        </div>

        {pane}
      </div>

      {/* Phone width: the same tree in a left drawer, closed on selection. */}
      <Sheet open={drawerOpen} onOpenChange={(next: boolean) => setDrawerOpen(next)}>
        <SheetContent side="left" className="overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle>Clients</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{drawerOpen ? panel : null}</div>
        </SheetContent>
      </Sheet>

      {startProject ? (
        <StartProjectDialog
          open={wizardFor !== null}
          onOpenChange={(next) => {
            if (!next) setWizardFor(null);
          }}
          templates={startProject.templates}
          prefill={wizardFor ?? { clientId: '', accountId: '' }}
          clients={wizardClients}
          accounts={wizardAccounts}
          assignees={startProject.assignees}
          canCreateAccount={startProject.canCreateAccount}
        />
      ) : null}
    </div>
  );
}

// features/projects/components/projects-workspace.tsx (PUL-417.2 + 417.5, §14.3 Amendment M)
//
// /projects as a two-pane workspace: the Client › Account › Project tree on the left, the
// selected node on the right (the filter bar and tabs, until 417.3 / 417.4 add the client and
// account overviews and slim the bar). At phone width the tree moves into a drawer.
//
// ── The URL is the selection (417.5) ────────────────────────────────────────────────────
// `/projects?client=…&account=…&project=…&tab=…`. Read with `useSearchParams` and resolved
// against the tree by `resolveSelection`: `?project=` alone (the Start Project landing) derives
// its account and client, and ids not in the tree are ignored. Moving the selection is a
// `history.pushState` (a tab change replaces instead), which Next.js syncs into
// `useSearchParams` without a server round trip, so Back and Forward walk the selection. After
// a mutation `router.refresh()` re-reads the tree; a selection whose node disappeared (archived)
// falls back to its parent on its own.

'use client';

import { FolderTreeIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { AccountRow, ClientRow, PickableClient } from '@/features/clients/queries';
import { parseProjectTab, type ProjectTabKey, type StatusMenuViewer } from '../display';
import {
  resolveSelection,
  selectionHref,
  type WorkspaceMenuFlags,
  type WorkspaceSelection,
  type WorkspaceTree,
} from '../workspace-tree';
import type { FilteredTaskRow, PickableProject, ProjectMonths } from '../queries';
import { ProjectsFilterBar } from './projects-filter-bar';
import { WorkspaceTreePanel } from './workspace-tree-panel';

/** The selection's deepest node name, for the drawer button. */
function selectionLabel(tree: WorkspaceTree, selection: WorkspaceSelection): string {
  const client = tree.find((c) => c.id === selection.client);
  const account = client?.accounts.find((a) => a.id === selection.account);
  const project = account?.projects.find((p) => p.id === selection.project);
  return project?.name ?? account?.name ?? client?.name ?? 'All clients';
}

export function ProjectsWorkspace({
  tree,
  flags,
  clientRows,
  accountRows,
  clients,
  projects,
  projectMonths,
  assignees,
  canExport,
  canCreateTask,
  viewer,
  initialTasks,
}: {
  /** Live nodes only (`getWorkspaceTree()`); it is also what the URL resolves against. */
  tree: WorkspaceTree;
  flags: WorkspaceMenuFlags;
  clientRows: ClientRow[];
  accountRows: AccountRow[];
  clients: PickableClient[];
  projects: PickableProject[];
  projectMonths: ProjectMonths[];
  assignees: { id: string; name: string }[];
  canExport: boolean;
  canCreateTask: boolean;
  viewer: StatusMenuViewer;
  /** The server's first task list, for the selection the URL named on load. */
  initialTasks: FilteredTaskRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const selection = useMemo(
    () =>
      resolveSelection(tree, {
        client: params.get('client'),
        account: params.get('account'),
        project: params.get('project'),
      }),
    [tree, params],
  );
  const tab = parseProjectTab(params.get('tab'), viewer.role);

  const clientsById = useMemo(() => new Map(clientRows.map((c) => [c.id, c])), [clientRows]);
  const accountsById = useMemo(() => new Map(accountRows.map((a) => [a.id, a])), [accountRows]);

  function navigate(next: WorkspaceSelection, nextTab: ProjectTabKey) {
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
    navigate(next, tab);
    setDrawerOpen(false);
  }

  const panel = (
    <WorkspaceTreePanel
      tree={tree}
      selection={selection}
      onSelect={selectFromTree}
      flags={flags}
      clientRows={clientsById}
      accountRows={accountsById}
    />
  );

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
            <span className="truncate">{selectionLabel(tree, selection)}</span>
          </Button>
        </div>

        <ProjectsFilterBar
          clients={clients}
          projects={projects}
          projectMonths={projectMonths}
          assignees={assignees}
          canExport={canExport}
          canCreateTask={canCreateTask}
          viewer={viewer}
          initialTasks={initialTasks}
          selection={selection}
          tab={tab}
          onNavigate={navigate}
          onTreeStale={() => router.refresh()}
        />
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
    </div>
  );
}

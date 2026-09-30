// features/projects/workspace-tree.ts (PUL-417.1)
//
// The §14.3 workspace tree (Amendment M): Client › Account › Project, as data, plus the pure
// helpers the page runs over it. No database and no `server-only` imports, so the client
// component can import `filterTree` and `resolveSelection` directly; `getWorkspaceTree` in
// queries.ts is the only producer of a tree and calls `buildWorkspaceTree` to shape its rows.

import { progressPct, projectHealth, type ProjectHealth } from './display';

/** A project leaf. The counts are over non-deleted tasks only. */
export interface WorkspaceProjectNode {
  id: string;
  name: string;
  /** `YYYY-MM-DD`, an Asia/Dhaka day: anchors the project pane's Month labels. */
  startDate: string;
  /** `status = 'archived'`. Only ever true when the tree was read with `includeArchived`. */
  archived: boolean;
  /** Tasks not yet closed: every status except approved / completed / cancelled (§3.1.3). */
  openTaskCount: number;
  /** Tasks in `submitted`. */
  awaitingReviewCount: number;
  /** The tree's review dot (§14.3): at least one task is awaiting review. */
  awaitingReview: boolean;
  /** `approved` + `completed` (§4.1 treats them identically). */
  doneTaskCount: number;
  /** Every task except cancelled ones, the §3.1 progress denominator. */
  totalTaskCount: number;
  /** Open tasks with `due_date` before today in Asia/Dhaka (§3.1.3): overviews and health. */
  overdueTaskCount: number;
}

export interface WorkspaceAccountNode {
  id: string;
  name: string;
  /** The local SEO market, free text. */
  location: string | null;
  /** `deleted_at` is set (account archive is a soft delete). */
  archived: boolean;
  projects: WorkspaceProjectNode[];
}

export interface WorkspaceClientNode {
  id: string;
  name: string;
  /** `deleted_at` is set (client archive is a soft delete). */
  archived: boolean;
  accounts: WorkspaceAccountNode[];
}

/** The whole tree: clients at the top, never a flat list (§13.8). */
export type WorkspaceTree = WorkspaceClientNode[];

/**
 * One row of the joined read in `getWorkspaceTree`: a client, LEFT JOINed to its accounts and
 * their projects, so a client with no accounts (or an account with no projects) still arrives
 * as one row with the deeper columns null. The counts are null when the project has no tasks.
 */
export interface WorkspaceRow {
  clientId: string;
  clientName: string;
  clientArchived: boolean;
  accountId: string | null;
  accountName: string | null;
  accountLocation: string | null;
  accountArchived: boolean | null;
  projectId: string | null;
  projectName: string | null;
  projectStartDate: string | null;
  projectArchived: boolean | null;
  openTaskCount: number | null;
  awaitingReviewCount: number | null;
  doneTaskCount: number | null;
  totalTaskCount: number | null;
  overdueTaskCount: number | null;
}

/**
 * Groups the joined rows into the nested tree. Order is first-seen, so the SQL's ORDER BY is
 * the tree's order at every level.
 */
export function buildWorkspaceTree(rows: readonly WorkspaceRow[]): WorkspaceTree {
  const tree: WorkspaceTree = [];
  const clientsById = new Map<string, WorkspaceClientNode>();
  const accountsById = new Map<string, WorkspaceAccountNode>();

  for (const row of rows) {
    let client = clientsById.get(row.clientId);
    if (!client) {
      client = {
        id: row.clientId,
        name: row.clientName,
        archived: row.clientArchived,
        accounts: [],
      };
      clientsById.set(client.id, client);
      tree.push(client);
    }

    if (row.accountId === null) continue;

    let account = accountsById.get(row.accountId);
    if (!account) {
      account = {
        id: row.accountId,
        name: row.accountName ?? '',
        location: row.accountLocation,
        archived: row.accountArchived ?? false,
        projects: [],
      };
      accountsById.set(account.id, account);
      client.accounts.push(account);
    }

    if (row.projectId === null) continue;

    const awaitingReviewCount = Number(row.awaitingReviewCount ?? 0);
    account.projects.push({
      id: row.projectId,
      name: row.projectName ?? '',
      startDate: row.projectStartDate ?? '',
      archived: row.projectArchived ?? false,
      openTaskCount: Number(row.openTaskCount ?? 0),
      awaitingReviewCount,
      awaitingReview: awaitingReviewCount > 0,
      doneTaskCount: Number(row.doneTaskCount ?? 0),
      totalTaskCount: Number(row.totalTaskCount ?? 0),
      overdueTaskCount: Number(row.overdueTaskCount ?? 0),
    });
  }

  return tree;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The §14.3 search box, matching names that contain `search` (trimmed, case-insensitive):
 *
 * - a matching **client or account** keeps its WHOLE subtree, so searching a partner or a
 *   business shows everything under it;
 * - a matching **project** keeps just that project, plus its account and client so it stays
 *   reachable in the tree.
 *
 * A blank search returns the tree unchanged.
 */
export function filterTree(tree: WorkspaceTree, search: string): WorkspaceTree {
  const needle = normalize(search);
  if (needle === '') return tree;

  const matches = (name: string) => normalize(name).includes(needle);
  const result: WorkspaceTree = [];

  for (const client of tree) {
    if (matches(client.name)) {
      result.push(client);
      continue;
    }

    const accounts: WorkspaceAccountNode[] = [];

    for (const account of client.accounts) {
      if (matches(account.name)) {
        accounts.push(account);
        continue;
      }
      // Not a match itself: survives only as the ancestor of a matching project.
      const projects = account.projects.filter((project) => matches(project.name));
      if (projects.length > 0) accounts.push({ ...account, projects });
    }

    if (accounts.length > 0) result.push({ ...client, accounts });
  }

  return result;
}

/** The `?client=&account=&project=` triple. Missing, empty, or unknown ids are null. */
export interface WorkspaceSelection {
  client: string | null;
  account: string | null;
  project: string | null;
}

/**
 * Reads the URL selection (§14.3: "the URL is the selection") against the tree.
 *
 * The deepest id that exists in the tree wins and its ancestors are derived from the tree, so
 * `?project=` alone (the Start Project landing) resolves its account and client, and a stale or
 * contradictory parent in the URL is corrected rather than trusted. Ids not in the tree are
 * dropped, falling back to the next level up.
 */
export function resolveSelection(
  tree: WorkspaceTree,
  wanted: { client?: string | null; account?: string | null; project?: string | null },
): WorkspaceSelection {
  if (wanted.project) {
    for (const client of tree) {
      for (const account of client.accounts) {
        if (account.projects.some((project) => project.id === wanted.project)) {
          return { client: client.id, account: account.id, project: wanted.project };
        }
      }
    }
  }

  if (wanted.account) {
    for (const client of tree) {
      if (client.accounts.some((account) => account.id === wanted.account)) {
        return { client: client.id, account: wanted.account, project: null };
      }
    }
  }

  if (wanted.client && tree.some((client) => client.id === wanted.client)) {
    return { client: wanted.client, account: null, project: null };
  }

  return { client: null, account: null, project: null };
}

/** The URL for a selection (§14.3: `/projects?client=…&account=…&project=…&tab=…`). */
export function selectionHref(selection: WorkspaceSelection, tab: string): string {
  const params = new URLSearchParams();
  if (selection.client) params.set('client', selection.client);
  if (selection.account) params.set('account', selection.account);
  if (selection.project) params.set('project', selection.project);
  // Board is the default, so a bare selection URL stays short.
  if (tab !== 'board') params.set('tab', tab);
  const query = params.toString();
  return query === '' ? '/projects' : `/projects?${query}`;
}

// ── The per-node ⋯ menu (§14.3) ─────────────────────────────────────────────────────────

/**
 * The viewer's §9.6 cells behind the ⋯ menu, computed with `can()` on the server page. Display
 * only: every action re-authorizes (§9.5 r.2).
 */
export interface WorkspaceMenuFlags {
  clientUpdate: boolean;
  clientArchive: boolean;
  accountCreate: boolean;
  accountUpdate: boolean;
  accountArchive: boolean;
  projectCreate: boolean;
  projectUpdate: boolean;
  projectArchive: boolean;
  /** `project.create` AND `template.read`: the template list is where the wizard starts. */
  startFromTemplate: boolean;
}

export type NodeMenuItem =
  'new_account' | 'new_project' | 'start_from_template' | 'rename' | 'archive';

export type WorkspaceNodeKind = 'client' | 'account' | 'project';

/**
 * Which §14.3 menu items a node offers this viewer, in display order.
 *
 * Each level adds the level below it: a client offers New account, an account offers New
 * project and Start from template, a project adds nothing. An archived node offers only Rename,
 * because creating under it or archiving it again is refused by the actions (`GATE:*_archived`).
 * An empty list means the ⋯ button is not rendered at all.
 */
export function nodeMenuItems(
  kind: WorkspaceNodeKind,
  archived: boolean,
  flags: WorkspaceMenuFlags,
): NodeMenuItem[] {
  const items: NodeMenuItem[] = [];

  if (kind === 'client') {
    if (flags.accountCreate && !archived) items.push('new_account');
    if (flags.clientUpdate) items.push('rename');
    if (flags.clientArchive && !archived) items.push('archive');
  } else if (kind === 'account') {
    if (flags.projectCreate && !archived) items.push('new_project');
    if (flags.startFromTemplate && !archived) items.push('start_from_template');
    if (flags.accountUpdate) items.push('rename');
    if (flags.accountArchive && !archived) items.push('archive');
  } else {
    if (flags.projectUpdate) items.push('rename');
    if (flags.projectArchive && !archived) items.push('archive');
  }

  return items;
}

// ── Collapse state (a per-viewer convenience, §14.3) ────────────────────────────────────

/**
 * Stored collapse state → the set of collapsed node ids. Anything unreadable (missing, not
 * JSON, not an array of strings) is an empty set, i.e. everything expanded: browser storage is
 * never authoritative and the tree must render without it.
 */
export function parseCollapsed(raw: string | null): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

/** The inverse of `parseCollapsed`. Sorted, so equal sets store identical strings. */
export function serializeCollapsed(collapsed: ReadonlySet<string>): string {
  return JSON.stringify([...collapsed].sort());
}

// ── The overviews (417.3) ───────────────────────────────────────────────────────────────

/** The nodes a selection points at, or undefined where nothing is selected at that level. */
export function selectedNodes(
  tree: WorkspaceTree,
  selection: WorkspaceSelection,
): {
  client?: WorkspaceClientNode;
  account?: WorkspaceAccountNode;
  project?: WorkspaceProjectNode;
} {
  const client = tree.find((c) => c.id === selection.client);
  const account = client?.accounts.find((a) => a.id === selection.account);
  const project = account?.projects.find((p) => p.id === selection.project);
  return { client, account, project };
}

/** One account card's numbers on the client overview (§14.3). */
export interface WorkspaceSummary {
  projectCount: number;
  done: number;
  total: number;
  /** `progressPct(done, total)`: the §3.1 rounding, 0 for nothing countable. */
  pct: number;
  open: number;
  awaitingReview: number;
  overdue: number;
}

/**
 * Sums a set of projects. Progress is pooled over TASKS (all done over all countable), not an
 * average of per-project percentages, so a one-task side project cannot swing the card.
 */
export function summarizeProjects(projects: readonly WorkspaceProjectNode[]): WorkspaceSummary {
  let done = 0;
  let total = 0;
  let open = 0;
  let awaitingReview = 0;
  let overdue = 0;
  for (const p of projects) {
    done += p.doneTaskCount;
    total += p.totalTaskCount;
    open += p.openTaskCount;
    awaitingReview += p.awaitingReviewCount;
    overdue += p.overdueTaskCount;
  }
  return {
    projectCount: projects.length,
    done,
    total,
    pct: progressPct(done, total),
    open,
    awaitingReview,
    overdue,
  };
}

/** The §3.1.3 health chip for a tree project: the same thresholds as the project header. */
export function projectNodeHealth(project: WorkspaceProjectNode): ProjectHealth {
  return projectHealth(project.overdueTaskCount, project.awaitingReviewCount);
}

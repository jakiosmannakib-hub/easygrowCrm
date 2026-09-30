// features/projects/workspace-tree.ts (PUL-417.1)
//
// The §14.3 workspace tree (Amendment M): Client › Account › Project, as data, plus the pure
// helpers the page runs over it. No database and no `server-only` imports, so the client
// component can import `filterTree` and `resolveSelection` directly; `getWorkspaceTree` in
// queries.ts is the only producer of a tree and calls `buildWorkspaceTree` to shape its rows.

/** A project leaf. The counts are over non-deleted tasks only. */
export interface WorkspaceProjectNode {
  id: string;
  name: string;
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
  projectArchived: boolean | null;
  openTaskCount: number | null;
  awaitingReviewCount: number | null;
  doneTaskCount: number | null;
  totalTaskCount: number | null;
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
      archived: row.projectArchived ?? false,
      openTaskCount: Number(row.openTaskCount ?? 0),
      awaitingReviewCount,
      awaitingReview: awaitingReviewCount > 0,
      doneTaskCount: Number(row.doneTaskCount ?? 0),
      totalTaskCount: Number(row.totalTaskCount ?? 0),
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

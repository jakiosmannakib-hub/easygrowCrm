// features/projects/workspace-tree.test.ts (PUL-417.7, helpers half)
//
// The pure helpers behind the §14.3 workspace tree: row grouping, the in-memory search, the URL
// selection, the per-node ⋯ menu gating and the stored collapse state. No database. The query
// itself is exercised in get-workspace-tree.test.ts.

import { describe, expect, it } from 'vitest';
import type { Role } from '../../lib/authz';
import { workspaceMenuFlags } from './capabilities';
import { parseAgencyTab, parseProjectTab } from './display';
import {
  buildWorkspaceTree,
  filterTree,
  nodeMenuItems,
  parseCollapsed,
  projectNodeHealth,
  resolveSelection,
  selectedNodes,
  selectionHref,
  serializeCollapsed,
  summarizeProjects,
  type WorkspaceMenuFlags,
  type WorkspaceProjectNode,
  type WorkspaceRow,
  type WorkspaceTree,
} from './workspace-tree';

function project(id: string, name: string): WorkspaceProjectNode {
  return {
    id,
    name,
    archived: false,
    openTaskCount: 0,
    awaitingReviewCount: 0,
    awaitingReview: false,
    doneTaskCount: 0,
    totalTaskCount: 0,
    overdueTaskCount: 0,
    startDate: '2026-01-01',
  };
}

/**
 *   Acme Partners
 *     Joe's Plumbing       → Local SEO Retainer, GEO Audit
 *     Bright Dental        → Website Launch
 *   Northwind Agency
 *     Harbor Cafe          → (no projects)
 *   Solo Client            → (no accounts)
 */
const TREE: WorkspaceTree = [
  {
    id: 'c_acme',
    name: 'Acme Partners',
    archived: false,
    accounts: [
      {
        id: 'a_joe',
        name: "Joe's Plumbing",
        location: 'Austin, TX',
        archived: false,
        projects: [project('p_retainer', 'Local SEO Retainer'), project('p_geo', 'GEO Audit')],
      },
      {
        id: 'a_bright',
        name: 'Bright Dental',
        location: null,
        archived: false,
        projects: [project('p_launch', 'Website Launch')],
      },
    ],
  },
  {
    id: 'c_north',
    name: 'Northwind Agency',
    archived: false,
    accounts: [
      { id: 'a_harbor', name: 'Harbor Cafe', location: null, archived: false, projects: [] },
    ],
  },
  { id: 'c_solo', name: 'Solo Client', archived: false, accounts: [] },
];

/** Flattens a tree back to `client/account/project` paths, so assertions read as a list. */
function paths(tree: WorkspaceTree): string[] {
  const out: string[] = [];
  for (const c of tree) {
    out.push(c.id);
    for (const a of c.accounts) {
      out.push(`${c.id}/${a.id}`);
      for (const p of a.projects) out.push(`${c.id}/${a.id}/${p.id}`);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('buildWorkspaceTree', () => {
  const base: WorkspaceRow = {
    clientId: 'c1',
    clientName: 'Client One',
    clientArchived: false,
    accountId: null,
    accountName: null,
    accountLocation: null,
    accountArchived: null,
    projectId: null,
    projectName: null,
    projectStartDate: null,
    projectArchived: null,
    openTaskCount: null,
    awaitingReviewCount: null,
    doneTaskCount: null,
    totalTaskCount: null,
    overdueTaskCount: null,
  };

  it('nests rows by client and account, keeping first-seen order', () => {
    const tree = buildWorkspaceTree([
      {
        ...base,
        accountId: 'a1',
        accountName: 'A1',
        accountArchived: false,
        projectId: 'p1',
        projectName: 'P1',
        projectArchived: false,
      },
      {
        ...base,
        accountId: 'a1',
        accountName: 'A1',
        accountArchived: false,
        projectId: 'p2',
        projectName: 'P2',
        projectArchived: false,
      },
      {
        ...base,
        accountId: 'a2',
        accountName: 'A2',
        accountArchived: false,
        projectId: 'p3',
        projectName: 'P3',
        projectArchived: false,
      },
      { ...base, clientId: 'c2', clientName: 'Client Two' },
    ]);

    expect(paths(tree)).toEqual(['c1', 'c1/a1', 'c1/a1/p1', 'c1/a1/p2', 'c1/a2', 'c1/a2/p3', 'c2']);
  });

  it('keeps a client with no accounts and an account with no projects', () => {
    const tree = buildWorkspaceTree([
      base,
      {
        ...base,
        clientId: 'c2',
        clientName: 'Two',
        accountId: 'a9',
        accountName: 'Empty',
        accountArchived: false,
      },
    ]);

    expect(paths(tree)).toEqual(['c1', 'c2', 'c2/a9']);
  });

  it('reads null counts as zero and derives the review dot from the submitted count', () => {
    const [quiet, busy] = buildWorkspaceTree([
      {
        ...base,
        accountId: 'a1',
        accountName: 'A1',
        accountArchived: false,
        projectId: 'p1',
        projectName: 'P1',
        projectArchived: false,
      },
      {
        ...base,
        accountId: 'a1',
        accountName: 'A1',
        accountArchived: false,
        projectId: 'p2',
        projectName: 'P2',
        projectArchived: false,
        openTaskCount: 4,
        awaitingReviewCount: 2,
        doneTaskCount: 3,
        totalTaskCount: 7,
        overdueTaskCount: 1,
        projectStartDate: '2026-03-15',
      },
    ])[0].accounts[0].projects;

    expect(quiet).toMatchObject({
      openTaskCount: 0,
      awaitingReviewCount: 0,
      awaitingReview: false,
      totalTaskCount: 0,
      overdueTaskCount: 0,
    });
    expect(busy).toMatchObject({
      openTaskCount: 4,
      awaitingReviewCount: 2,
      awaitingReview: true,
      doneTaskCount: 3,
      totalTaskCount: 7,
      overdueTaskCount: 1,
      startDate: '2026-03-15',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('the overviews (417.3)', () => {
  const counted = (
    id: string,
    c: { done: number; total: number; open: number; review: number; overdue: number },
  ): WorkspaceProjectNode => ({
    ...project(id, id),
    doneTaskCount: c.done,
    totalTaskCount: c.total,
    openTaskCount: c.open,
    awaitingReviewCount: c.review,
    awaitingReview: c.review > 0,
    overdueTaskCount: c.overdue,
  });

  it('pools an account card over tasks, not an average of project percentages', () => {
    // 9/10 and 0/1: averaging the percentages would say 45%; pooled it is 9/11 = 82%.
    expect(
      summarizeProjects([
        counted('p1', { done: 9, total: 10, open: 1, review: 1, overdue: 0 }),
        counted('p2', { done: 0, total: 1, open: 1, review: 0, overdue: 1 }),
      ]),
    ).toEqual({
      projectCount: 2,
      done: 9,
      total: 11,
      pct: 82,
      open: 2,
      awaitingReview: 1,
      overdue: 1,
    });
  });

  it('summarizes an account with no projects as zeros, not NaN', () => {
    expect(summarizeProjects([])).toEqual({
      projectCount: 0,
      done: 0,
      total: 0,
      pct: 0,
      open: 0,
      awaitingReview: 0,
      overdue: 0,
    });
  });

  it('gives a tree project the same §3.1.3 health as the header', () => {
    const health = (overdue: number, review: number) =>
      projectNodeHealth(counted('p', { done: 0, total: 5, open: 5, review, overdue }));
    expect(health(0, 0)).toBe('on_track');
    expect(health(1, 0)).toBe('at_risk');
    expect(health(0, 3)).toBe('at_risk');
    expect(health(2, 0)).toBe('delayed');
    expect(health(4, 9)).toBe('critical');
  });

  it('finds the selected nodes, and nothing below the deepest selected level', () => {
    expect(selectedNodes(TREE, { client: 'c_acme', account: 'a_bright', project: null })).toEqual({
      client: TREE[0],
      account: TREE[0].accounts[1],
      project: undefined,
    });
    expect(selectedNodes(TREE, { client: null, account: null, project: null })).toEqual({
      client: undefined,
      account: undefined,
      project: undefined,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('filterTree', () => {
  it('returns the tree unchanged for a blank search', () => {
    expect(filterTree(TREE, '')).toBe(TREE);
    expect(filterTree(TREE, '   ')).toBe(TREE);
  });

  it('keeps a matching project together with its account and client, and nothing else', () => {
    // The ancestor-keeping rule: "GEO" matches only a project, and neither "Joe's Plumbing" nor
    // "Acme Partners" contains it. Dropping them would leave the project unreachable in a tree.
    // Its sibling project (Local SEO Retainer) does not match and goes.
    expect(paths(filterTree(TREE, 'geo'))).toEqual([
      'c_acme',
      'c_acme/a_joe',
      'c_acme/a_joe/p_geo',
    ]);
  });

  it('drops non-matching siblings at every level for a project match', () => {
    // "Launch" is under Acme but in the other account; Joe's Plumbing and its projects go.
    expect(paths(filterTree(TREE, 'launch'))).toEqual([
      'c_acme',
      'c_acme/a_bright',
      'c_acme/a_bright/p_launch',
    ]);
  });

  it('keeps a matching account with its whole subtree and its client', () => {
    // Neither project under Joe's Plumbing contains "plumbing"; both stay because the account
    // matched. The sibling account (Bright Dental) does not match and goes.
    expect(paths(filterTree(TREE, 'plumbing'))).toEqual([
      'c_acme',
      'c_acme/a_joe',
      'c_acme/a_joe/p_retainer',
      'c_acme/a_joe/p_geo',
    ]);
    expect(paths(filterTree(TREE, 'harbor'))).toEqual(['c_north', 'c_north/a_harbor']);
  });

  it('keeps a matching client with its whole subtree', () => {
    // No account or project under Acme contains "acme"; all of them stay.
    expect(paths(filterTree(TREE, 'acme'))).toEqual([
      'c_acme',
      'c_acme/a_joe',
      'c_acme/a_joe/p_retainer',
      'c_acme/a_joe/p_geo',
      'c_acme/a_bright',
      'c_acme/a_bright/p_launch',
    ]);
    expect(paths(filterTree(TREE, 'solo'))).toEqual(['c_solo']);
  });

  it('is case-insensitive and trims the search', () => {
    expect(paths(filterTree(TREE, '  BRIGHT dental '))).toEqual([
      'c_acme',
      'c_acme/a_bright',
      'c_acme/a_bright/p_launch',
    ]);
  });

  it('returns an empty tree when nothing matches', () => {
    expect(filterTree(TREE, 'zzz')).toEqual([]);
  });

  it('does not mutate the input tree', () => {
    const before = structuredClone(TREE);
    filterTree(TREE, 'geo');
    expect(TREE).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('resolveSelection', () => {
  const none = { client: null, account: null, project: null };

  it('derives the account and client from ?project= alone (the Start Project landing)', () => {
    expect(resolveSelection(TREE, { project: 'p_launch' })).toEqual({
      client: 'c_acme',
      account: 'a_bright',
      project: 'p_launch',
    });
  });

  it('derives the client from ?account= alone', () => {
    expect(resolveSelection(TREE, { account: 'a_harbor' })).toEqual({
      client: 'c_north',
      account: 'a_harbor',
      project: null,
    });
  });

  it('keeps a lone ?client=', () => {
    expect(resolveSelection(TREE, { client: 'c_solo' })).toEqual({ ...none, client: 'c_solo' });
  });

  it('corrects contradictory parents from the deepest valid id', () => {
    expect(
      resolveSelection(TREE, { client: 'c_north', account: 'a_harbor', project: 'p_geo' }),
    ).toEqual({
      client: 'c_acme',
      account: 'a_joe',
      project: 'p_geo',
    });
  });

  it('drops an unknown project and falls back to the account', () => {
    expect(resolveSelection(TREE, { account: 'a_joe', project: 'p_gone' })).toEqual({
      client: 'c_acme',
      account: 'a_joe',
      project: null,
    });
  });

  it('drops an unknown account and falls back to the client', () => {
    expect(resolveSelection(TREE, { client: 'c_acme', account: 'a_gone' })).toEqual({
      ...none,
      client: 'c_acme',
    });
  });

  it('selects nothing when every id is unknown or missing', () => {
    expect(
      resolveSelection(TREE, { client: 'c_gone', account: 'a_gone', project: 'p_gone' }),
    ).toEqual(none);
    expect(resolveSelection(TREE, {})).toEqual(none);
    expect(resolveSelection(TREE, { client: '', account: null, project: undefined })).toEqual(none);
  });

  it('does not find a project that the filtered tree no longer holds', () => {
    // The selection resolves against whatever tree it is given, e.g. the live-only tree
    // after the project was archived.
    expect(resolveSelection(filterTree(TREE, 'harbor'), { project: 'p_geo' })).toEqual(none);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('selectionHref (the URL is the selection, §14.3)', () => {
  const sel = { client: 'c_acme', account: 'a_joe', project: 'p_geo' };

  it('writes every selected level, and the tab only when it is not the Board default', () => {
    expect(selectionHref(sel, 'board')).toBe('/projects?client=c_acme&account=a_joe&project=p_geo');
    expect(selectionHref(sel, 'list')).toBe(
      '/projects?client=c_acme&account=a_joe&project=p_geo&tab=list',
    );
    expect(selectionHref({ client: null, account: null, project: null }, 'board')).toBe(
      '/projects',
    );
    expect(selectionHref({ client: null, account: null, project: null }, 'review')).toBe(
      '/projects?tab=review',
    );
  });

  it('round-trips through resolveSelection', () => {
    const url = new URL(selectionHref(sel, 'calendar'), 'http://x');
    const back = resolveSelection(TREE, {
      client: url.searchParams.get('client'),
      account: url.searchParams.get('account'),
      project: url.searchParams.get('project'),
    });
    expect(back).toEqual(sel);
  });
});

describe('parseProjectTab', () => {
  it('accepts a tab the role can see and falls back to the Board otherwise', () => {
    expect(parseProjectTab('list', 'employee')).toBe('list');
    expect(parseProjectTab('review', 'project_manager')).toBe('review');
    expect(parseProjectTab('workload', 'admin_hr')).toBe('workload');
    // Review and Workload are MGR/HR tabs (§14.3): an employee's link lands on the Board.
    expect(parseProjectTab('review', 'employee')).toBe('board');
    expect(parseProjectTab('nonsense', 'super_admin')).toBe('board');
    expect(parseProjectTab(null, 'super_admin')).toBe('board');
  });
});

describe('parseAgencyTab (nothing selected, §14.3 Amendment M)', () => {
  it('defaults to Review and accepts Workload for MGR and HR', () => {
    expect(parseAgencyTab(null, 'team_leader')).toBe('review');
    expect(parseAgencyTab('workload', 'admin_hr')).toBe('workload');
    // A project-only tab carried over from a project selection falls back to Review.
    expect(parseAgencyTab('board', 'super_admin')).toBe('review');
  });

  it('is null for an employee, who sees neither agency tab', () => {
    expect(parseAgencyTab('review', 'employee')).toBeNull();
    expect(parseAgencyTab(null, 'employee')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('nodeMenuItems with the real §9.6 flags (workspaceMenuFlags)', () => {
  const menusFor = (role: Role) => {
    const flags = workspaceMenuFlags({ id: 'u', role, active: true });
    return {
      client: nodeMenuItems('client', false, flags),
      account: nodeMenuItems('account', false, flags),
      project: nodeMenuItems('project', false, flags),
    };
  };

  it('gives the super admin every item', () => {
    expect(menusFor('super_admin')).toEqual({
      client: ['new_account', 'rename', 'archive'],
      account: ['new_project', 'start_from_template', 'rename', 'archive'],
      project: ['rename', 'archive'],
    });
  });

  it('gives TL and PM accounts and projects but not client rename or archive (§9.6 ¹²)', () => {
    const expected = {
      client: ['new_account'],
      account: ['new_project', 'start_from_template', 'rename', 'archive'],
      project: ['rename', 'archive'],
    };
    expect(menusFor('team_leader')).toEqual(expected);
    expect(menusFor('project_manager')).toEqual(expected);
  });

  it('gives HR clients and accounts but nothing that creates or changes a project', () => {
    expect(menusFor('admin_hr')).toEqual({
      client: ['new_account', 'rename', 'archive'],
      account: ['rename', 'archive'],
      project: [],
    });
  });

  it('gives an employee no menu at all', () => {
    expect(menusFor('employee')).toEqual({ client: [], account: [], project: [] });
  });
});

describe('nodeMenuItems on an archived node', () => {
  const all: WorkspaceMenuFlags = {
    clientUpdate: true,
    clientArchive: true,
    accountCreate: true,
    accountUpdate: true,
    accountArchive: true,
    projectCreate: true,
    projectUpdate: true,
    projectArchive: true,
    startFromTemplate: true,
  };

  it('offers only Rename: nothing can be created under it or archived twice', () => {
    expect(nodeMenuItems('client', true, all)).toEqual(['rename']);
    expect(nodeMenuItems('account', true, all)).toEqual(['rename']);
    expect(nodeMenuItems('project', true, all)).toEqual(['rename']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────

describe('parseCollapsed / serializeCollapsed (browser storage is never authoritative)', () => {
  it('round-trips a set, sorted so equal sets store equal strings', () => {
    const stored = serializeCollapsed(new Set(['c_b', 'a_1', 'c_a']));
    expect(stored).toBe('["a_1","c_a","c_b"]');
    expect([...parseCollapsed(stored)].sort()).toEqual(['a_1', 'c_a', 'c_b']);
  });

  it('reads anything unreadable as nothing collapsed', () => {
    expect(parseCollapsed(null).size).toBe(0);
    expect(parseCollapsed('').size).toBe(0);
    expect(parseCollapsed('{not json').size).toBe(0);
    expect(parseCollapsed('{"a":1}').size).toBe(0);
    expect(parseCollapsed('"c_acme"').size).toBe(0);
  });

  it('keeps only the string ids from a mixed array', () => {
    expect([...parseCollapsed('["c_acme", 3, null, "a_joe"]')]).toEqual(['c_acme', 'a_joe']);
  });
});

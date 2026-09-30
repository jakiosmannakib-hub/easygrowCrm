// features/projects/workspace-tree.test.ts (PUL-417.7, helpers half)
//
// The pure helpers behind the §14.3 workspace tree: row grouping, the in-memory search, and the
// URL selection. No database. The query itself is exercised in get-workspace-tree.test.ts.

import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceTree,
  filterTree,
  resolveSelection,
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
    projectArchived: null,
    openTaskCount: null,
    awaitingReviewCount: null,
    doneTaskCount: null,
    totalTaskCount: null,
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
      },
    ])[0].accounts[0].projects;

    expect(quiet).toMatchObject({
      openTaskCount: 0,
      awaitingReviewCount: 0,
      awaitingReview: false,
      totalTaskCount: 0,
    });
    expect(busy).toMatchObject({
      openTaskCount: 4,
      awaitingReviewCount: 2,
      awaitingReview: true,
      doneTaskCount: 3,
      totalTaskCount: 7,
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

// features/projects/components/workspace-tree-panel.tsx (PUL-417.2, §14.3 Amendment M)
//
// The left pane of /projects: a collapsible `📁 Client › 🏢 Account › 📋 Project` tree from
// `getWorkspaceTree`, with each project's open-task count and a dot when it has tasks awaiting
// review, a search box (`filterTree`, in memory), and the per-node ⋯ menu.
//
// Selection is not held here: the workspace passes the URL's resolved selection down and a
// click reports the new one up (§14.3: "the URL is the selection").
//
// ── Collapse state ───────────────────────────────────────────────────────────────────────
// A per-viewer convenience in localStorage, never authoritative (§14.3). Read through
// `useSyncExternalStore` so the server render and hydration both see "nothing collapsed" and
// the stored state lands on the next render without a hydration mismatch. Every storage call is
// wrapped: in a private window or with storage blocked the store keeps working in memory for
// the session, and the tree renders fully expanded without it.

'use client';

import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Input } from '@/components/ui/input';
import type { AccountRow, ClientRow } from '@/features/clients/queries';
import { cn } from '@/lib/utils';
import {
  filterTree,
  nodeMenuItems,
  parseCollapsed,
  serializeCollapsed,
  type WorkspaceMenuFlags,
  type WorkspaceSelection,
  type WorkspaceTree,
} from '../workspace-tree';
import { WorkspaceNodeMenu } from './workspace-node-menu';

// ── The collapse store ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'easygrow.projects.tree.collapsed';

/** `undefined` until first read; then the raw stored string (or `null` for nothing stored). */
let cachedRaw: string | null | undefined;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  if (cachedRaw === undefined) {
    try {
      cachedRaw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      cachedRaw = null;
    }
  }
  return cachedRaw;
}

function writeRaw(raw: string) {
  cachedRaw = raw;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Storage unavailable or full: the in-memory copy still drives this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it: drop the cache so the next read picks the new value up.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cachedRaw = undefined;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function useCollapsed(): ReadonlySet<string> {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseCollapsed(raw), [raw]);
}

// ── The panel ───────────────────────────────────────────────────────────────────────────

export function WorkspaceTreePanel({
  tree,
  selection,
  onSelect,
  onStartFromTemplate,
  flags,
  clientRows,
  accountRows,
}: {
  tree: WorkspaceTree;
  selection: WorkspaceSelection;
  onSelect: (selection: WorkspaceSelection) => void;
  /** An account's "Start from template": open the wizard with this client and account. */
  onStartFromTemplate: (prefill: { clientId: string; accountId: string }) => void;
  flags: WorkspaceMenuFlags;
  /** Full rows for the reused client dialogs, by id. Empty when the viewer manages none. */
  clientRows: ReadonlyMap<string, ClientRow>;
  /** Full rows for the reused account dialogs, by id. */
  accountRows: ReadonlyMap<string, AccountRow>;
}) {
  const [search, setSearch] = useState('');
  const collapsed = useCollapsed();

  /**
   * The selection's ancestors when this panel mounted, shown open whatever storage says, so a
   * deep link (`?project=` from the Start Project landing) is visible. Collapsing one by hand
   * removes it from this set, so it stays collapsible.
   */
  const [pinnedOpen, setPinnedOpen] = useState<ReadonlySet<string>>(
    () => new Set([selection.client, selection.account].filter((id): id is string => id !== null)),
  );

  const searching = search.trim() !== '';
  const visible = useMemo(() => filterTree(tree, search), [tree, search]);

  // While searching every surviving node is shown open, or a match could hide under a
  // collapsed parent.
  const isOpen = (id: string) => searching || pinnedOpen.has(id) || !collapsed.has(id);

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (isOpen(id)) {
      next.add(id);
      if (pinnedOpen.has(id)) {
        const pinned = new Set(pinnedOpen);
        pinned.delete(id);
        setPinnedOpen(pinned);
      }
    } else {
      next.delete(id);
    }
    writeRaw(serializeCollapsed(next));
  }

  const nothingSelected = !selection.client && !selection.account && !selection.project;

  return (
    <nav aria-label="Clients, accounts and projects" className="space-y-2">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search clients, accounts, projects"
        aria-label="Search the workspace tree"
      />

      <button
        type="button"
        onClick={() => onSelect({ client: null, account: null, project: null })}
        aria-current={nothingSelected ? 'page' : undefined}
        className={rowClass(nothingSelected, 'w-full px-2 text-left')}
      >
        All clients
      </button>

      {visible.length === 0 ? (
        <p className="text-muted-foreground px-2 text-xs">
          {searching ? 'Nothing matches that search.' : 'No clients yet.'}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {visible.map((client) => {
            const clientRow = clientRows.get(client.id);
            const clientOpen = isOpen(client.id);
            const clientSelected =
              selection.client === client.id && !selection.account && !selection.project;

            return (
              <li key={client.id}>
                <div className={rowClass(clientSelected, 'group')}>
                  <Chevron
                    open={clientOpen}
                    hidden={client.accounts.length === 0}
                    label={client.name}
                    onToggle={() => toggle(client.id)}
                  />
                  <button
                    type="button"
                    onClick={() => onSelect({ client: client.id, account: null, project: null })}
                    aria-current={clientSelected ? 'page' : undefined}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    <span aria-hidden="true">📁 </span>
                    {client.name}
                  </button>
                  {clientRow ? (
                    <WorkspaceNodeMenu
                      target={{ kind: 'client', client: clientRow }}
                      items={nodeMenuItems('client', client.archived, flags)}
                    />
                  ) : null}
                </div>

                {clientOpen && client.accounts.length > 0 ? (
                  <ul className="ml-4 space-y-0.5">
                    {client.accounts.map((account) => {
                      const accountRow = accountRows.get(account.id);
                      const accountOpen = isOpen(account.id);
                      const accountSelected =
                        selection.account === account.id && !selection.project;

                      return (
                        <li key={account.id}>
                          <div className={rowClass(accountSelected, 'group')}>
                            <Chevron
                              open={accountOpen}
                              hidden={account.projects.length === 0}
                              label={account.name}
                              onToggle={() => toggle(account.id)}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                onSelect({ client: client.id, account: account.id, project: null })
                              }
                              aria-current={accountSelected ? 'page' : undefined}
                              className="min-w-0 flex-1 truncate text-left"
                            >
                              <span aria-hidden="true">🏢 </span>
                              {account.name}
                            </button>
                            {clientRow && accountRow ? (
                              <WorkspaceNodeMenu
                                target={{ kind: 'account', client: clientRow, account: accountRow }}
                                items={nodeMenuItems('account', account.archived, flags)}
                                onStartFromTemplate={() =>
                                  onStartFromTemplate({
                                    clientId: client.id,
                                    accountId: account.id,
                                  })
                                }
                                onProjectCreated={(projectId) =>
                                  onSelect({
                                    client: client.id,
                                    account: account.id,
                                    project: projectId,
                                  })
                                }
                              />
                            ) : null}
                          </div>

                          {accountOpen && account.projects.length > 0 ? (
                            <ul className="ml-4 space-y-0.5">
                              {account.projects.map((project) => {
                                const projectSelected = selection.project === project.id;
                                return (
                                  <li key={project.id}>
                                    <div className={rowClass(projectSelected, 'group pl-5')}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onSelect({
                                            client: client.id,
                                            account: account.id,
                                            project: project.id,
                                          })
                                        }
                                        aria-current={projectSelected ? 'page' : undefined}
                                        className="min-w-0 flex-1 truncate text-left"
                                      >
                                        <span aria-hidden="true">📋 </span>
                                        {project.name}
                                      </button>
                                      {project.awaitingReview ? (
                                        <span
                                          className="bg-primary size-1.5 shrink-0 rounded-full"
                                          role="img"
                                          aria-label="Has tasks awaiting review"
                                          title="Has tasks awaiting review"
                                        />
                                      ) : null}
                                      <span
                                        className="text-muted-foreground shrink-0 text-[11px] tabular-nums"
                                        title="Open tasks"
                                      >
                                        {project.openTaskCount}
                                        <span className="sr-only"> open tasks</span>
                                      </span>
                                      <WorkspaceNodeMenu
                                        target={{
                                          kind: 'project',
                                          project: { id: project.id, name: project.name },
                                        }}
                                        items={nodeMenuItems('project', project.archived, flags)}
                                      />
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

function rowClass(selected: boolean, extra?: string) {
  return cn(
    'flex min-h-7 items-center gap-1 rounded-md py-0.5 pr-1 text-xs',
    selected ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted/60',
    extra,
  );
}

function Chevron({
  open,
  hidden,
  label,
  onToggle,
}: {
  open: boolean;
  /** No children: keep the space so names still line up, but offer nothing to toggle. */
  hidden: boolean;
  label: string;
  onToggle: () => void;
}) {
  if (hidden) return <span className="size-4 shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
      className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
    >
      {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
    </button>
  );
}

// features/projects/components/workspace-node-menu.tsx (PUL-417.2, §14.3 Amendment M)
//
// The ⋯ menu on each workspace tree node: New account / New project / Start from template /
// Rename / Archive. Which items appear is `nodeMenuItems` over the viewer's server-computed
// `can()` flags; an empty list renders no button. Presentation only: every action
// re-authorizes (§9.5 r.2).
//
// Reuses the existing dialogs where they exist: the /clients client form and archive confirm,
// the account form and archive confirm, and `ArchiveProjectBody`, the confirm the project header
// uses too (§14.15 r.6). Project rename and New project had no dialog, so two small bodies live
// here, calling §13.3.3 `updateProject` and §13.3.1 `createProject`. Start from template opens
// /templates, where the wizard lives (417.6 prefills its account).
//
// Same conventions as the clients dialogs: a controlled Dialog, the body mounted only while
// open (MOUNTING IS THE RESET), `router.refresh()` after a write so the tree re-reads. Nothing
// is optimistic, and every refusal, GATE included, goes through `showErrorToast`.

'use client';

import { MoreHorizontalIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountFormBody, ArchiveAccountBody } from '@/features/clients/components/client-accounts';
import { ClientFormBody } from '@/features/clients/components/client-form';
import { ArchiveConfirmBody } from '@/features/clients/components/clients-list';
import type { AccountRow, ClientRow } from '@/features/clients/queries';
import { dhakaToday } from '@/lib/format';
import { showErrorToast } from '@/lib/show-error-toast';
import { createProject, updateProject } from '../actions';
import { CreateProjectInput } from '../schema';
import type { NodeMenuItem } from '../workspace-tree';
import { ArchiveProjectBody } from './archive-project-body';

/** What the menu acts on. Client and account carry their full rows for the reused forms. */
export type NodeMenuTarget =
  | { kind: 'client'; client: ClientRow }
  | { kind: 'account'; client: ClientRow; account: AccountRow }
  | { kind: 'project'; project: { id: string; name: string } };

const ITEM_LABEL: Record<NodeMenuItem, string> = {
  new_account: 'New account',
  new_project: 'New project',
  start_from_template: 'Start from template',
  rename: 'Rename',
  archive: 'Archive',
};

type OpenDialog = Exclude<NodeMenuItem, 'start_from_template'> | null;

export function WorkspaceNodeMenu({
  target,
  items,
  onProjectCreated,
}: {
  target: NodeMenuTarget;
  /** From `nodeMenuItems`; empty renders nothing. */
  items: NodeMenuItem[];
  /** Selects a project just created from this menu. */
  onProjectCreated?: (projectId: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenDialog>(null);

  if (items.length === 0) return null;

  const name =
    target.kind === 'client'
      ? target.client.name
      : target.kind === 'account'
        ? target.account.name
        : target.project.name;

  function onPick(item: NodeMenuItem) {
    if (item === 'start_from_template') {
      router.push('/templates');
      return;
    }
    setOpen(item);
  }

  const close = () => setOpen(null);

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Actions for ${name}`}
              className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <MenuContent>
          {items.map((item) => (
            <MenuItem
              key={item}
              variant={item === 'archive' ? 'destructive' : 'default'}
              onClick={() => onPick(item)}
            >
              {ITEM_LABEL[item]}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      {/* Controlled, no Trigger: opened by the menu. Each body mounts only while open. */}
      <Dialog
        open={open !== null}
        onOpenChange={(next: boolean) => {
          if (!next) close();
        }}
      >
        <DialogContent className="sm:max-w-md">
          {open === 'new_account' && target.kind === 'client' ? (
            <AccountFormBody client={target.client} account={null} onDone={close} />
          ) : null}
          {open === 'rename' && target.kind === 'client' ? (
            <ClientFormBody client={target.client} onDone={close} />
          ) : null}
          {open === 'archive' && target.kind === 'client' ? (
            <ArchiveConfirmBody client={target.client} onDone={close} />
          ) : null}
          {open === 'new_project' && target.kind === 'account' ? (
            <NewProjectBody
              account={target.account}
              onDone={(projectId) => {
                close();
                onProjectCreated?.(projectId);
              }}
            />
          ) : null}
          {open === 'rename' && target.kind === 'account' ? (
            <AccountFormBody client={target.client} account={target.account} onDone={close} />
          ) : null}
          {open === 'archive' && target.kind === 'account' ? (
            <ArchiveAccountBody account={target.account} onDone={close} />
          ) : null}
          {open === 'rename' && target.kind === 'project' ? (
            <RenameProjectBody project={target.project} onDone={close} />
          ) : null}
          {open === 'archive' && target.kind === 'project' ? (
            <ArchiveProjectBody
              project={target.project}
              onArchived={() => router.refresh()}
              onDone={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Rename project ──────────────────────────────────────────────────────────────────────

function RenameProjectBody({
  project,
  onDone,
}: {
  project: { id: string; name: string };
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const changed = trimmed !== project.name;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed) {
      setError('Give the project a name.');
      return;
    }
    if (!changed) {
      toast.info('No changes to save.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const result = await updateProject({ projectId: project.id, name: trimmed });
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`Renamed to ${trimmed}.`);
      router.refresh();
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Rename {project.name}</DialogTitle>
        <DialogDescription>The new name shows everywhere the project appears.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={`project-${project.id}-name`}>Name</Label>
        <Input
          id={`project-${project.id}-name`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          autoFocus
        />
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>
      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button">
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={saving || !changed}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── New project (blank; templates go through the wizard) ────────────────────────────────

/** §11.2's two non-template project types. A template-made project takes its category. */
const PROJECT_TYPES = ['Retainer', 'One-off'] as const;

function NewProjectBody({
  account,
  onDone,
}: {
  account: AccountRow;
  /** Called with the new project's id after a successful create. */
  onDone: (projectId: string) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    type: 'Retainer' as string,
    startDate: dhakaToday(),
    deadline: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('Give the project a name.');
      return;
    }
    if (!form.startDate) {
      setError('Pick a start date.');
      return;
    }

    // The same schema the action parses: a convenience, not the gate (§9.5 r.2). What is left
    // to fail here is the deadline-before-start refine, whose message is already readable.
    const parsed = CreateProjectInput.safeParse({
      accountId: account.id,
      name: form.name.trim(),
      type: form.type,
      startDate: form.startDate,
      deadline: form.deadline || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the dates.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const result = await createProject(parsed.data);
      if (!result.ok) {
        showErrorToast(result);
        return;
      }
      toast.success(`${result.data.name} created.`);
      router.refresh();
      onDone(result.data.id);
    } finally {
      setSaving(false);
    }
  }

  const idPrefix = `new-project-${account.id}`;

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>New project for {account.name}</DialogTitle>
        <DialogDescription>
          A blank project. To generate its tasks from a template, use Start from template instead.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Local SEO Retainer"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <Select
            value={form.type}
            onValueChange={(v: string | null) => set('type', v ?? 'Retainer')}
          >
            <SelectTrigger id={`${idPrefix}-type`} className="w-full">
              <SelectValue>{(v: string | null) => v ?? 'Retainer'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-start`}>Start date</Label>
            <Input
              id={`${idPrefix}-start`}
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-deadline`}>Deadline</Label>
            <Input
              id={`${idPrefix}-deadline`}
              type="date"
              value={form.deadline}
              onChange={(e) => set('deadline', e.target.value)}
            />
          </div>
        </div>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button">
              Cancel
            </Button>
          }
        />
        <Button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create project'}
        </Button>
      </DialogFooter>
    </form>
  );
}

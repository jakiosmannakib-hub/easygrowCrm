// features/projects/components/archive-project-body.tsx (PUL-417, §14.15 r.6)
//
// The one confirm for archiving a project, rendered inside a `DialogContent` by both callers:
// the project header's overflow menu and the workspace tree's ⋯ menu. Same shape as the clients
// slice's `ArchiveAccountBody`: mounted only while open, not optimistic (archive is an audited
// accountability action, §14.15 r.5), refusals through `showErrorToast`.
//
// No "you can unarchive it later" line: no screen calls `unarchiveProject` yet, so the copy
// would promise something the UI cannot do.

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showErrorToast } from '@/lib/show-error-toast';
import { archiveProject } from '../actions';

export function ArchiveProjectBody({
  project,
  onArchived,
  onDone,
}: {
  project: { id: string; name: string };
  /** After a successful archive: the caller re-reads whatever shows the project. */
  onArchived: () => void;
  /** Closes the dialog. Called after success; a refusal leaves it open. */
  onDone: () => void;
}) {
  const [archiving, setArchiving] = useState(false);

  async function onConfirm() {
    setArchiving(true);
    try {
      const result = await archiveProject({ projectId: project.id });
      if (!result.ok) {
        // Including GATE:pending_reviews, whose message already names the blocking task.
        showErrorToast(result);
        return;
      }
      toast.success(`${project.name} archived.`);
      onArchived();
      onDone();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Archive {project.name}?</DialogTitle>
        <DialogDescription>It leaves every picker and becomes read-only.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose
          render={
            <Button variant="outline" type="button" disabled={archiving}>
              Cancel
            </Button>
          }
        />
        <Button onClick={onConfirm} disabled={archiving}>
          {archiving ? 'Archiving…' : 'Archive project'}
        </Button>
      </DialogFooter>
    </>
  );
}

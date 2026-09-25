// features/templates/components/delete-template-button.tsx — PUL-503 Stage 2, §14.4.1
//
// The card's `×`: a "Confirm delete?" dialog, then §13.3.6c `deleteTemplate` (a soft delete).
// Not optimistic: the dialog waits for the server, and the grid is refreshed from the server
// afterwards, so a template only leaves the grid once the delete actually committed. The action
// re-checks `template.delete` regardless of whether this button rendered (§9.5 rule 2).

'use client';

import { XIcon } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { showErrorToast } from '@/lib/show-error-toast';
import { deleteTemplate } from '../actions';

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onConfirm() {
    setDeleting(true);
    try {
      const result = await deleteTemplate({ templateId: id });
      if (!result.ok) {
        // Every server error goes through the PUL-106 mapper; the dialog stays open.
        showErrorToast(result);
        return;
      }
      toast.success(`${name} deleted.`);
      setOpen(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${name}`} title="Delete template">
            <XIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm delete?</DialogTitle>
          <DialogDescription>
            {name} will be removed from the templates list. Running projects are unaffected: they
            hold their own copy of its tasks.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

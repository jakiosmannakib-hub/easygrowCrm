// features/templates/components/confirm-delete-button.tsx — PUL-503 Stage 3a
//
// The `×` + "Confirm delete?" step every template-level delete uses (template card, month,
// category). The dialog is opened by its own `DialogTrigger`, so Base UI reports the open and
// there is no controlled-dialog trap to work around; there is also no on-open fetch.
//
// Not optimistic: the dialog stays open, with the button disabled, until the server answers.
// `onConfirm` resolves `true` on success, and only then does the dialog close.

'use client';

import { XIcon } from 'lucide-react';
import { useState } from 'react';
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

export function ConfirmDeleteButton({
  label,
  description,
  confirmLabel,
  onConfirm,
}: {
  /** Accessible name of the `×`, e.g. "Delete Month 1". */
  label: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    try {
      if (await onConfirm()) setOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => setOpen(next)}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
            <XIcon />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm delete?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button">
                Cancel
              </Button>
            }
          />
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting ? 'Deleting…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

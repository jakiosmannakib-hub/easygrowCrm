// features/templates/components/delete-template-button.tsx — PUL-503 Stage 2, §14.4.1
//
// The card's `×`: "Confirm delete?", then §13.3.6c `deleteTemplate` (a soft delete). Not
// optimistic: the grid is refreshed from the server afterwards, so a template only leaves the grid
// once the delete actually committed. The action re-checks `template.delete` regardless of
// whether this button rendered (§9.5 rule 2).

'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { showErrorToast } from '@/lib/show-error-toast';
import { deleteTemplate } from '../actions';
import { ConfirmDeleteButton } from './confirm-delete-button';

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  async function onConfirm() {
    const result = await deleteTemplate({ templateId: id });
    if (!result.ok) {
      // Every server error goes through the PUL-106 mapper; the dialog stays open.
      showErrorToast(result);
      return false;
    }
    toast.success(`${name} deleted.`);
    router.refresh();
    return true;
  }

  return (
    <ConfirmDeleteButton
      label={`Delete ${name}`}
      description={`${name} will be removed from the templates list. Running projects are unaffected: they hold their own copy of its tasks.`}
      confirmLabel="Delete template"
      onConfirm={onConfirm}
    />
  );
}

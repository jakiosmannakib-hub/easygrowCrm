// features/templates/components/inline-name-form.tsx — PUL-503 Stage 3a
//
// The one-field inline editor behind Rename month / Rename category and Add category (§14.4.5's
// "single required text field", done inline instead of in a modal). The parent renders it ONLY
// while editing, so MOUNTING IS THE RESET: the draft is seeded from `initial` at mount, and
// there is no effect re-seeding state (the React Compiler lint rule rejects that).
//
// Keyboard: the input takes focus on mount, Enter saves, Escape cancels.

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function InlineNameForm({
  initial = '',
  label,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: string;
  /** The input's accessible name, e.g. "Month name". */
  label: string;
  submitLabel: string;
  /** Resolves `true` when the server accepted it; the parent then closes the form. */
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) {
      setError('Enter a name.');
      return;
    }
    // Unchanged: nothing to send.
    if (name === initial.trim()) {
      onCancel();
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      // Not optimistic: the form stays open until the server confirms.
      await onSave(name);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        className="h-7 w-56 max-w-full"
        autoFocus
      />
      <Button type="submit" size="sm" disabled={saving}>
        {saving ? 'Saving…' : submitLabel}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      {error ? <p className="text-destructive w-full text-xs">{error}</p> : null}
    </form>
  );
}

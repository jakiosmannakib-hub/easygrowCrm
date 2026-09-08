// app/dev/errors/page.tsx — PUL-106.3
//
// Dev-only harness: one button per §13 code (plus a few GATE reasons) that throws the
// matching AppError through showErrorToast, so the rendering can be eyeballed. It builds
// AppErrors directly — how an error crosses the server-action boundary is deferred to the
// first Phase 2 action, and this page deliberately does not pre-empt that decision.

'use client';

import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AppError } from '@/lib/errors';
import { showErrorToast } from '@/lib/show-error-toast';

interface Sample {
  label: string;
  build: () => AppError;
}

const SAMPLES: Sample[] = [
  { label: 'UNAUTHENTICATED', build: () => new AppError('UNAUTHENTICATED') },
  { label: 'DEACTIVATED', build: () => new AppError('DEACTIVATED') },
  { label: 'FORBIDDEN', build: () => new AppError('FORBIDDEN') },
  { label: 'NOT_FOUND', build: () => new AppError('NOT_FOUND') },
  {
    label: 'VALIDATION (server message)',
    build: () => new AppError('VALIDATION', 'Estimated hours must be greater than zero.'),
  },
  {
    label: 'VALIDATION (no message)',
    build: () => new AppError('VALIDATION'),
  },
  {
    label: 'GATE — checklist_incomplete',
    build: () => new AppError('GATE', undefined, { reason: 'checklist_incomplete' }),
  },
  {
    label: 'GATE — last_managers',
    build: () => new AppError('GATE', undefined, { reason: 'last_managers' }),
  },
  {
    label: 'GATE — unknown reason (fallback)',
    build: () => new AppError('GATE', undefined, { reason: 'not_in_the_registry_yet' }),
  },
  {
    label: 'CONFLICT (offers Refresh)',
    build: () => new AppError('CONFLICT'),
  },
];

export default function DevErrorsPage() {
  // Guard: this harness must never exist in production.
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="font-heading text-2xl">Error toasts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Dev-only (PUL-106). Each button throws the matching AppError through{' '}
          <code>showErrorToast</code>. Only CONFLICT offers Refresh (§14.15 r.3).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {SAMPLES.map((sample) => (
          <Button
            key={sample.label}
            variant="outline"
            className="justify-start"
            onClick={() => showErrorToast(sample.build())}
          >
            {sample.label}
          </Button>
        ))}
      </div>
    </main>
  );
}

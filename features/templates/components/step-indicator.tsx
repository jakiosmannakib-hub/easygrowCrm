// features/templates/components/step-indicator.tsx — PUL-504, shared at PUL-506
//
// The numbered step strip the template wizards share: Add Month (§14.4.3, 3 steps) and Start
// Project (§14.3.8, 4 steps). Done = check, current = brand, future = muted.

import { CheckIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** `step` is 1-based and indexes `labels`. */
export function StepIndicator({ labels, step }: { labels: readonly string[]; step: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Wizard steps">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'future';
        return (
          <li
            key={label}
            className="flex items-center gap-1.5 text-xs"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[0.625rem] font-medium',
                state === 'done' && 'bg-primary/15 text-primary',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'future' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <CheckIcon className="size-3" /> : n}
            </span>
            <span className={cn(state === 'future' && 'text-muted-foreground')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

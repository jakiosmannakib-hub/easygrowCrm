// app/dev/task-detail/task-detail-qa.tsx — PUL-407 Stage 2
//
// The client half of the dev QA harness: holds "which task is open" and renders the one modal.
// THROWAWAY SCAFFOLDING — the Board (PUL-409) is the real opener, and this whole directory goes
// away then. See page.tsx.

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { TaskDetailModal } from '@/features/projects/components/task-detail-modal';
import { StatusPill } from '@/features/projects/components/status-pill';
import type { TaskStatus } from '@/features/projects/display';

export interface QaTask {
  id: string;
  title: string;
  status: TaskStatus;
  projectName: string;
}

export function TaskDetailQa({ tasks }: { tasks: QaTask[] }) {
  // One piece of state, not a boolean plus an id: `openTaskId` IS the open flag, so the two can
  // never disagree. The modal stays mounted with the last id while it animates out (`open`
  // false), which is why `taskId` falls back rather than unmounting the whole modal.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-3">
            <Button
              variant="outline"
              className="min-w-0 flex-1 justify-start"
              onClick={() => setOpenTaskId(task.id)}
            >
              <span className="truncate">{task.title}</span>
            </Button>
            <StatusPill status={task.status} />
            <code className="text-muted-foreground shrink-0 text-[0.625rem]">{task.id}</code>
          </li>
        ))}
      </ul>

      {/*
        One modal for the whole list, keyed inside by taskId — clicking straight from one task
        to another is exactly the stale-response case the body's in-flight guard exists for, so
        QA should try it.
      */}
      <TaskDetailModal
        taskId={openTaskId ?? ''}
        open={openTaskId !== null}
        onClose={() => setOpenTaskId(null)}
      />
    </>
  );
}

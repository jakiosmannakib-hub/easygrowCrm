// app/dev/task-detail/page.tsx — PUL-407 Stage 2
//
// Dev-only harness for the §14.3.3 Task Detail modal: every live task in the database, each
// with a button that opens the modal on it.
//
// **THROWAWAY QA SCAFFOLDING.** The Board (PUL-409) is the real opener — a card click opens the
// same modal on that card's task. This page exists only so Stage 2's read + rendering can be
// eyeballed against real rows before there is a board to click, and this whole directory should
// be deleted when PUL-409 lands. Nothing outside /dev may import from it.
//
// Guarded exactly like app/dev/errors: `notFound()` in production, before any render.
//
// A dev database will not reach every §14.3.3 state on its own — `tests/seed.ts` is test-DB
// only, and has no `completed`, `cancelled` or `depends_on` row even there. `qa-states.sql`
// beside this file arranges the missing ones; it exists instead of widening `seedMinimal`,
// which §15.5 fixes and which every DB test pays for.
//
// The query below reads `db` directly rather than going through features/projects/queries.ts.
// That is deliberate and confined to this file: "list every task in the system" is not a real
// product query and must not become one — the product lists tasks per project, through the
// board. Reads may run anywhere (CLAUDE.md §2); only writes are confined to actions.

import { notFound } from 'next/navigation';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { projectTasks, projects } from '@/db/schema';
import { requireRouteAccess } from '@/lib/route-guard';
import { TaskDetailQa, type QaTask } from './task-detail-qa';

export default async function DevTaskDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ taskId?: string }>;
}) {
  // Guard first: this harness must never exist in production.
  if (process.env.NODE_ENV === 'production') notFound();

  // Still a real page behind a real session — `loadTaskDetail` authorizes `project.read` and
  // `getTaskDetail` re-reads the session, so an unauthenticated visitor would get a modal full
  // of errors rather than a useful QA surface. `/projects` is open to every role (§9.6).
  await requireRouteAccess('/projects');

  const { taskId } = await searchParams;

  const rows = await db
    .select({
      id: projectTasks.id,
      title: projectTasks.title,
      status: projectTasks.status,
      projectName: projects.name,
    })
    .from(projectTasks)
    .innerJoin(projects, eq(projects.id, projectTasks.projectId))
    .where(
      taskId
        ? and(eq(projectTasks.id, taskId), isNull(projectTasks.deletedAt))
        : isNull(projectTasks.deletedAt)
    )
    .orderBy(asc(projects.name), asc(projectTasks.title));

  const tasks: QaTask[] = rows;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="font-heading text-2xl">Task Detail modal</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Dev-only (PUL-407 Stage 2). Every section renders read-only — the controls are
          deliberately disabled until Stage 3. Add <code>?taskId=…</code> to focus one task.
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tasks in this database. Seed one, or check <code>?taskId</code>.
        </p>
      ) : (
        <TaskDetailQa tasks={tasks} />
      )}
    </main>
  );
}

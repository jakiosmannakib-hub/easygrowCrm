// app/(app)/templates/[id]/page.tsx — PUL-503 Stage 2 (stub), §14.4.2
//
// STUB. Renders only the §14.4.2 header card (category badge, name, description, the meta row)
// and the Back to templates link, so that + New Template's navigation lands somewhere real.
//
// TODO(PUL-503 Stage 3): the month → category → task → subtask tree with its inline add /
// rename / delete, the Add/Edit Task modal (§14.4.4), and the header's Edit details / Start
// Project buttons. HR sees all of that read-only (§14.4.2).

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { CategoryBadge, MetaRow, RolePills } from '@/features/templates/components/template-summary';
import { loadTemplateTree } from '@/features/templates/queries';
import { templateMeta } from '@/features/templates/template-meta';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // THE security boundary (§9.5). The detail view has the same audience as the grid (§14.1 /
  // §9.6 `template.read`), so it reuses the /templates guard. That guard is also the call-site
  // authorization for `loadTemplateTree`, which does not authorize itself.
  await requireRouteAccess('/templates');

  const { id } = await params;

  // Missing and soft-deleted templates both come back null → 404.
  const tree = await loadTemplateTree(db, id);
  if (!tree) notFound();

  return (
    <div className="space-y-4">
      <Link href="/templates" className="text-muted-foreground text-xs hover:underline">
        ← Back to templates
      </Link>

      <Card>
        <CardHeader className="gap-2">
          <CategoryBadge category={tree.category} />
          <CardTitle className="text-lg">{tree.name}</CardTitle>
          {tree.description ? (
            <p className="text-muted-foreground text-sm">{tree.description}</p>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-2">
          <MetaRow meta={templateMeta(tree)} />
          <RolePills roles={tree.roles} />
        </CardContent>
      </Card>

      {/* PUL-503 Stage 3: the month → category → task tree renders here. */}
    </div>
  );
}

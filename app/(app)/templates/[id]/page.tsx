// app/(app)/templates/[id]/page.tsx — PUL-503, §14.4.2
//
// The template detail view: Back link, header card, breadcrumb hint, then the month → category →
// task → subtask tree with month / category inline CRUD (Stage 3a) and the Add/Edit Task modal
// (Stage 3b, §14.4.4).
//
// Not built yet: the header card's Edit details (§13.3.6b `updateTemplate`) and Start Project
// (PUL-506) buttons.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { db } from '@/db';
import { CategoryBadge, MetaRow, RolePills } from '@/features/templates/components/template-summary';
import { TemplateTree } from '@/features/templates/components/template-tree';
import { loadTemplateTree } from '@/features/templates/queries';
import { templateMeta, templateRoles } from '@/features/templates/template-meta';
import { can } from '@/lib/authz';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // THE security boundary (§9.5). The detail view has the same audience as the grid (§14.1 /
  // §9.6 `template.read`), so it reuses the /templates guard. That guard is also the call-site
  // authorization for `loadTemplateTree`, which does not authorize itself.
  const viewer = await requireRouteAccess('/templates');

  const { id } = await params;

  // Missing and soft-deleted templates both come back null → 404.
  const tree = await loadTemplateTree(db, id);
  if (!tree) notFound();

  // §14.4.2: HR sees the whole tree read-only. Presentation only; each action re-authorizes.
  const canEdit = can(viewer, 'template.update');

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
          <RolePills roles={templateRoles(tree)} />
        </CardContent>
      </Card>

      {/* Breadcrumb hint (§14.4.2): visual only, not clickable. */}
      <p className="text-muted-foreground text-xs" aria-hidden>
        Agency › {tree.name} › Month › Category › Task
      </p>

      <TemplateTree tree={tree} canEdit={canEdit} />
    </div>
  );
}

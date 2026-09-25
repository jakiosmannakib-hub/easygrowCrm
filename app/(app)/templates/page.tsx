// app/(app)/templates/page.tsx — PUL-110.4, built out by PUL-503 Stage 2 (§14.4.1)

import { NewTemplateDialog } from '@/features/templates/components/new-template-dialog';
import type { TemplateCardData } from '@/features/templates/components/template-summary';
import { TemplatesGrid } from '@/features/templates/components/templates-grid';
import { templatesListQuery } from '@/features/templates/queries';
import { templateMeta } from '@/features/templates/template-meta';
import { can } from '@/lib/authz';
import { PAGE_META } from '@/lib/nav';
import { requireRouteAccess } from '@/lib/route-guard';

export default async function TemplatesPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The §14.1
  // `visibleTo` for /templates (SA, HR, PM, TL) is exactly the §9.6 `template.read` audience, so
  // an employee, who has no `template.read`, gets the 404. `templatesListQuery` does not
  // authorize itself; this guard is its call-site check.
  const viewer = await requireRouteAccess('/templates');

  const { title, subtitle } = PAGE_META['/templates'];

  // Soft-deleted templates are already excluded by the query. The card counts are derived here
  // from each tree (via tplAllTasks), so the client receives card data, not trees.
  const trees = await templatesListQuery();
  const templates: TemplateCardData[] = trees.map((tree) => ({
    id: tree.id,
    name: tree.name,
    description: tree.description,
    category: tree.category,
    roles: tree.roles,
    meta: templateMeta(tree),
  }));

  // §14.4.1 role visibility (§9.6 ⁹): HR sees the grid read-only, with no + New Template, no
  // card delete and no Start Project. Presentation only; each action re-authorizes.
  const canCreate = can(viewer, 'template.create');
  const permissions = {
    canDelete: can(viewer, 'template.delete'),
    canStartProject: can(viewer, 'project.create'),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-heading text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{subtitle}</p>
        </div>
        {canCreate ? <NewTemplateDialog /> : null}
      </div>

      <TemplatesGrid templates={templates} permissions={permissions} />
    </div>
  );
}

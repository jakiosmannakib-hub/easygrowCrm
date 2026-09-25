// features/templates/components/templates-grid.tsx — PUL-503 Stage 2, §14.4.1
//
// The template cards. No 'use client': the grid is static markup, and only the delete button is a
// client island. Visibility of the edit affordances is decided by the page (from `can()` on the
// DB-read viewer) and passed in; it is presentation only, since every action re-authorizes.

import Link from 'next/link';
import { buttonVariants, Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteTemplateButton } from './delete-template-button';
import { CategoryBadge, MetaRow, RolePills, type TemplateCardData } from './template-summary';

export interface TemplateGridPermissions {
  /** `template.delete`: SA · TL · PM. HR sees no `×` (§14.4.1). */
  canDelete: boolean;
  /** `project.create`: HR sees no Start Project (§14.4.1). */
  canStartProject: boolean;
}

export function TemplatesGrid({
  templates,
  permissions,
}: {
  templates: TemplateCardData[];
  permissions: TemplateGridPermissions;
}) {
  if (templates.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        No templates yet.
      </p>
    );
  }

  return (
    // §14.4.1: auto-fill, min 340px. `min(340px, 100%)` keeps one column from overflowing a
    // phone-width screen.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-4">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} permissions={permissions} />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  permissions,
}: {
  template: TemplateCardData;
  permissions: TemplateGridPermissions;
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <CategoryBadge category={template.category} />
          {permissions.canDelete ? (
            <DeleteTemplateButton id={template.id} name={template.name} />
          ) : null}
        </div>
        <CardTitle className="text-base">{template.name}</CardTitle>
        {template.description ? (
          <p className="text-muted-foreground text-xs">{template.description}</p>
        ) : null}
      </CardHeader>

      <CardContent className="mt-auto grid gap-2">
        <RolePills roles={template.roles} />
        <MetaRow meta={template.meta} />
      </CardContent>

      <CardFooter className="gap-2">
        <Link
          href={`/templates/${template.id}`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          View
        </Link>
        {permissions.canStartProject ? (
          // Disabled until PUL-506 ships the Start Project wizard. The title sits on a wrapper
          // because a disabled button takes no pointer events, so its own title never shows.
          <span title="Available once the Start Project wizard ships">
            <Button size="sm" disabled>
              Start Project
            </Button>
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

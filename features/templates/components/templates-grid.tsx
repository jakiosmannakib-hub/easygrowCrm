// features/templates/components/templates-grid.tsx — PUL-503 Stage 2, §14.4.1
//
// The template cards. No 'use client': the grid is static markup, and only the delete button is a
// client island. Visibility of the edit affordances is decided by the page (from `can()` on the
// DB-read viewer) and passed in; it is presentation only, since every action re-authorizes.
// The delete button and the Start Project wizard are the client islands.

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { StartProjectTemplate } from '../start-project';
import { DeleteTemplateButton } from './delete-template-button';
import { StartProjectWizard, type AccountOption, type PickOption } from './start-project-wizard';
import { CategoryBadge, MetaRow, RolePills, type TemplateCardData } from './template-summary';

export interface TemplateGridPermissions {
  /** `template.delete`: SA · TL · PM. HR sees no `×` (§14.4.1). */
  canDelete: boolean;
}

/**
 * What the Start Project wizard needs, or `null` when the viewer lacks `project.create` (HR,
 * §14.4.1): then no card renders the button and none of this data is sent to the browser.
 */
export interface StartProjectData {
  clients: PickOption[];
  /** Live accounts of live clients (Amendment M); step 1 filters them by the picked client. */
  accounts: AccountOption[];
  assignees: PickOption[];
  /** `can(viewer, 'account.create')`: the wizard's "+ New account" (PUL-417.6). */
  canCreateAccount: boolean;
  /** Per template id. */
  templates: Record<string, StartProjectTemplate>;
}

export function TemplatesGrid({
  templates,
  permissions,
  startProject,
}: {
  templates: TemplateCardData[];
  permissions: TemplateGridPermissions;
  startProject: StartProjectData | null;
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
        <TemplateCard
          key={t.id}
          template={t}
          permissions={permissions}
          startProject={startProject}
        />
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  permissions,
  startProject,
}: {
  template: TemplateCardData;
  permissions: TemplateGridPermissions;
  startProject: StartProjectData | null;
}) {
  const wizardTemplate = startProject?.templates[template.id];
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
        {startProject && wizardTemplate ? (
          <StartProjectWizard
            template={wizardTemplate}
            clients={startProject.clients}
            accounts={startProject.accounts}
            assignees={startProject.assignees}
            canCreateAccount={startProject.canCreateAccount}
          />
        ) : null}
      </CardFooter>
    </Card>
  );
}

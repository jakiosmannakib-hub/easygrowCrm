// features/templates/components/template-summary.tsx — PUL-503 Stage 2
//
// The pieces a template card (§14.4.1) and the detail header card (§14.4.2) both show: the
// color-coded category badge, the role pills and the `N tasks · N months · N roles · N QC gates`
// row. No hooks and no 'use client', so a server component can render them directly.

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { UNCATEGORISED, catBadgeClass } from '../display';
import { formatTemplateMeta, type TemplateMeta } from '../template-meta';

/**
 * What a card needs, computed on the server from the tree. The client components get this and
 * never the tree itself: the counts are `templateMeta(tree)`, derived once where the tree is.
 */
export interface TemplateCardData {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  /** `templateRoles(tree)`: the roles the tasks use, NOT the `templates.roles` palette. */
  roles: string[];
  meta: TemplateMeta;
}

export function CategoryBadge({ category }: { category: string | null }) {
  return (
    <Badge variant="outline" className={cn('uppercase tracking-wide', catBadgeClass(category))}>
      {category ?? UNCATEGORISED}
    </Badge>
  );
}

export function RolePills({ roles }: { roles: string[] }) {
  if (roles.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="secondary">
          {role}
        </Badge>
      ))}
    </div>
  );
}

export function MetaRow({ meta }: { meta: TemplateMeta }) {
  return <p className="text-muted-foreground text-xs">{formatTemplateMeta(meta)}</p>;
}

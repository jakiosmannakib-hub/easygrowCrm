// features/templates/display.ts — PUL-503 Stage 2
//
// Presentation constants for the templates slice: the category badge colors and the two pick
// lists the New Template modal offers. Pure and client-safe.
//
// The lists are the prototype's `TEMPLATE_CATS` / `TEMPLATE_ROLES` / `CAT_BADGE_COLOR`, taken as
// VISUAL reference only (Amendment A): the PRD names no fixed category or role list. The
// database stores both as free text (`templates.category`, `templates.roles`), so nothing here
// constrains what an older or seeded template may hold: an unknown category just gets the
// fallback badge.

/** The template-level categories the New Template modal offers (§14.4.1 "category ▾"). */
export const TEMPLATE_CATEGORIES = [
  'SEO',
  'Website Design',
  'Marketing',
  'Video Editing',
  'Development',
] as const;

/** The delivery roles the New Template modal offers (§14.4.1 "roles (checkbox list)"). */
export const TEMPLATE_ROLES = [
  'Project Manager',
  'SEO Executive',
  'Content Writer',
  'Web Designer',
  'Developer',
  'QC',
  'Client Success Manager',
] as const;

/**
 * Category badge colors (§14.4.1 "category badge (color-coded)"). The hues follow the
 * prototype's hexes (SEO #0d7e72, Website Design #2f80ed, Marketing #8e5ad1, Video Editing
 * #e8a13d, Development #d64545). They are full static class strings so Tailwind's scanner keeps
 * them, the same rule as the projects category palette.
 */
export const CAT_BADGE: Record<string, string> = {
  SEO: 'bg-teal-600/10 text-teal-700 border-teal-600/30 dark:text-teal-300',
  'Website Design': 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-300',
  Marketing: 'bg-violet-500/10 text-violet-700 border-violet-500/30 dark:text-violet-300',
  'Video Editing': 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
  Development: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-300',
};

/** The badge for a null or unrecognised category. */
export const CAT_BADGE_FALLBACK = 'bg-muted text-muted-foreground border-border';

/** Badge classes for a template category, falling back for null / unknown values. */
export function catBadgeClass(category: string | null): string {
  return (category !== null && CAT_BADGE[category]) || CAT_BADGE_FALLBACK;
}

/** What the badge says when a template has no category. */
export const UNCATEGORISED = 'Uncategorised';

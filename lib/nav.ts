// lib/nav.ts — PUL-110.1/110.3, §14.1.
//
// The navigation data model. Pure and dependency-free so it imports cleanly into BOTH the
// server (the route guard) and the client (the sidebar). That is why `icon` is a lucide
// icon NAME rather than a component: storing a component here would drag client-only code
// into every server module that needs to know which routes a role may open.
//
// WHY `visibleTo` IS TRANSCRIBED, NOT DERIVED FROM can():
// §14.1's "Visible to" column is curated and does not fall out of any single §9.6 action.
// Audit Log is `scoped` for HR (a narrowed read, but the item still shows); Review is hidden
// from employees even though `review.read` is `self` for them. Deriving visibility from one
// action would therefore produce the wrong sidebar in both directions. The list below is a
// transcription of the §14.1 table, and the real security is `requireRouteAccess` in
// lib/route-guard.ts — §14.1 is explicit that "the sidebar is cosmetic".

import type { Role } from './authz';

export type AppRoute =
  | '/dashboard'
  | '/employees'
  | '/attendance'
  | '/clients'
  | '/projects'
  | '/templates'
  | '/my-tasks'
  | '/daily-plan'
  | '/eod'
  | '/leave'
  | '/review'
  | '/reports'
  | '/audit'
  | '/settings';

export interface NavItem {
  route: AppRoute;
  label: string;
  /** A lucide-react icon name, resolved to a component by the client sidebar. */
  icon: string;
  visibleTo: Role[];
}

/** All five roles — §14.1's "all". */
const ALL: Role[] = ['super_admin', 'admin_hr', 'project_manager', 'team_leader', 'employee'];
/** §14.1's "SA, HR". */
const SA_HR: Role[] = ['super_admin', 'admin_hr'];
/** §14.1's "SA, HR, PM, TL" — everyone except employees. */
const MANAGERS: Role[] = ['super_admin', 'admin_hr', 'project_manager', 'team_leader'];

/**
 * The 14 sidebar items in §14.1 order. `visibleTo` is transcribed from that table verbatim,
 * plus Clients: moved out of Settings into its own page, directly above Projects. Its audience
 * is everyone who can manage something on it (§9.6: `client.*` SA/HR, `account.*` SA/HR/TL/PM),
 * so employees, who hold neither, do not get the item or the route.
 */
export const NAV_ITEMS: NavItem[] = [
  { route: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard', visibleTo: ALL },
  { route: '/employees', label: 'Employees', icon: 'Users', visibleTo: SA_HR },
  { route: '/attendance', label: 'Attendance', icon: 'Clock', visibleTo: ALL },
  { route: '/clients', label: 'Clients', icon: 'Building2', visibleTo: MANAGERS },
  { route: '/projects', label: 'Projects', icon: 'FolderKanban', visibleTo: ALL },
  { route: '/templates', label: 'Project Templates', icon: 'LayoutTemplate', visibleTo: MANAGERS },
  { route: '/my-tasks', label: 'My Tasks', icon: 'ListChecks', visibleTo: MANAGERS },
  { route: '/daily-plan', label: 'Daily Task Plan', icon: 'CalendarCheck', visibleTo: ALL },
  { route: '/eod', label: 'End-of-Day Reports', icon: 'FileText', visibleTo: ALL },
  { route: '/leave', label: 'Leave Requests', icon: 'CalendarOff', visibleTo: ALL },
  { route: '/review', label: 'Review', icon: 'ClipboardCheck', visibleTo: MANAGERS },
  { route: '/reports', label: 'Reports', icon: 'BarChart3', visibleTo: MANAGERS },
  { route: '/audit', label: 'Audit Log', icon: 'ScrollText', visibleTo: SA_HR },
  { route: '/settings', label: 'Settings', icon: 'Settings', visibleTo: SA_HR },
];

/** Header copy per route (§14.1: "page title + subtitle from a PAGE_META map"). */
export const PAGE_META: Record<AppRoute, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Dashboard', subtitle: 'Your day at a glance' },
  '/employees': { title: 'Employees', subtitle: 'People, roles, and offboarding' },
  '/attendance': { title: 'Attendance', subtitle: 'Sign-in, breaks, and hours' },
  '/clients': { title: 'Clients', subtitle: 'White-label partners and the businesses they resell to' },
  '/projects': { title: 'Projects', subtitle: 'Client work and delivery boards' },
  '/templates': { title: 'Project Templates', subtitle: 'Reusable month, category, and task structures' },
  '/my-tasks': { title: 'My Tasks', subtitle: 'Your private checklist' },
  '/daily-plan': { title: 'Daily Task Plan', subtitle: "What you're working on today" },
  '/eod': { title: 'End-of-Day Reports', subtitle: 'Wrap up the day and acknowledge reports' },
  '/leave': { title: 'Leave Requests', subtitle: 'Requests, decisions, and quota' },
  '/review': { title: 'Review', subtitle: 'Work waiting on your decision' },
  '/reports': { title: 'Reports', subtitle: 'Delivery, attendance, and leave' },
  '/audit': { title: 'Audit Log', subtitle: 'Viewing this log is itself logged' },
  '/settings': { title: 'Settings', subtitle: 'Working hours, holidays, and policy' },
};


/** The sidebar items a role sees, in §14.1 order. Cosmetic — never the security boundary. */
export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.visibleTo.includes(role));
}

/**
 * Whether a role may open a route. Pure, so it is testable without a database — this is the
 * predicate the server guard enforces, and the sidebar merely agrees with it.
 */
export function canAccessRoute(role: Role, route: AppRoute): boolean {
  const item = NAV_ITEMS.find((i) => i.route === route);
  // No entry means no route: an unknown route is denied rather than open by default.
  return item ? item.visibleTo.includes(role) : false;
}

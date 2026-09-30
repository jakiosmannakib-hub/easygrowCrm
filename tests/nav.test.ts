// tests/nav.test.ts — PUL-110 Stop 1
//
// Makes §14.1's done-check mechanical: "each role shows exactly the §14.1 set". The expected
// sets below are transcribed from the §14.1 table independently of lib/nav.ts, so a typo in
// either one fails rather than agreeing with itself.
//
// Not a §15.4 mandatory test. It guards the sidebar (cosmetic) AND canAccessRoute, which the
// server route guard enforces — so the second half is a real security assertion.

import { describe, expect, it } from 'vitest';
import type { Role } from '../lib/authz';
import { canAccessRoute, NAV_ITEMS, PAGE_META, visibleNavItems, type AppRoute } from '../lib/nav';

const ALL_ROUTES: AppRoute[] = [
  '/dashboard',
  '/employees',
  '/attendance',
  '/clients',
  '/projects',
  '/templates',
  '/my-tasks',
  '/daily-plan',
  '/eod',
  '/leave',
  '/review',
  '/reports',
  '/audit',
  '/settings',
];

/** §14.1's "all" column. */
const EMPLOYEE_ROUTES: AppRoute[] = [
  '/dashboard',
  '/attendance',
  '/projects',
  '/daily-plan',
  '/eod',
  '/leave',
];

/** SA, HR, PM, TL rows minus the three SA/HR-only ones. Clients is not one of them. */
const MANAGER_ROUTES: AppRoute[] = [
  '/dashboard',
  '/attendance',
  '/clients',
  '/projects',
  '/templates',
  '/my-tasks',
  '/daily-plan',
  '/eod',
  '/leave',
  '/review',
  '/reports',
];

const EXPECTED: Record<Role, AppRoute[]> = {
  super_admin: ALL_ROUTES,
  admin_hr: ALL_ROUTES,
  project_manager: MANAGER_ROUTES,
  team_leader: MANAGER_ROUTES,
  employee: EMPLOYEE_ROUTES,
};

describe('the nav table itself', () => {
  it('has all 14 items (§14.1 plus Clients), in order, with no duplicates', () => {
    expect(NAV_ITEMS).toHaveLength(14);
    expect(NAV_ITEMS.map((i) => i.route)).toEqual(ALL_ROUTES);
  });

  it('gives every route header copy', () => {
    for (const route of ALL_ROUTES) {
      expect(PAGE_META[route]?.title, route).toBeTruthy();
      expect(PAGE_META[route]?.subtitle, route).toBeTruthy();
    }
  });

  it('stores an icon name, not a component, so the table stays server-importable', () => {
    for (const item of NAV_ITEMS) {
      expect(typeof item.icon, item.route).toBe('string');
    }
  });
});

describe('visibleNavItems — each role sees exactly the §14.1 set', () => {
  for (const role of Object.keys(EXPECTED) as Role[]) {
    it(`${role}`, () => {
      expect(visibleNavItems(role).map((i) => i.route)).toEqual(EXPECTED[role]);
    });
  }

  it('the counts §14.1 implies', () => {
    expect(visibleNavItems('super_admin')).toHaveLength(14);
    expect(visibleNavItems('admin_hr')).toHaveLength(14);
    expect(visibleNavItems('project_manager')).toHaveLength(11);
    expect(visibleNavItems('team_leader')).toHaveLength(11);
    expect(visibleNavItems('employee')).toHaveLength(6);
  });

  it('puts Clients directly above Projects', () => {
    const routes = NAV_ITEMS.map((i) => i.route);
    expect(routes.indexOf('/clients')).toBe(routes.indexOf('/projects') - 1);
  });
});

describe('canAccessRoute — the predicate the server guard enforces', () => {
  it('agrees with visibleNavItems for every role × route pair', () => {
    for (const role of Object.keys(EXPECTED) as Role[]) {
      for (const route of ALL_ROUTES) {
        expect(canAccessRoute(role, route), `${role} × ${route}`).toBe(
          EXPECTED[role].includes(route),
        );
      }
    }
  });

  it('denies an employee the SA/HR surfaces', () => {
    expect(canAccessRoute('employee', '/employees')).toBe(false);
    expect(canAccessRoute('employee', '/audit')).toBe(false);
    expect(canAccessRoute('employee', '/settings')).toBe(false);
  });

  it('opens /clients to SA, HR, TL and PM, and denies an employee', () => {
    // The route guard 404s the employee like every other guarded page (lib/route-guard.ts).
    for (const role of ['super_admin', 'admin_hr', 'team_leader', 'project_manager'] as const) {
      expect(canAccessRoute(role, '/clients'), role).toBe(true);
    }
    expect(canAccessRoute('employee', '/clients')).toBe(false);
  });

  it('denies an employee /review even though review.read is `self` for them', () => {
    // The reconciliation this whole file exists for: nav visibility is curated, not derived
    // from a single can() cell.
    expect(canAccessRoute('employee', '/review')).toBe(false);
  });

  it('allows admin_hr /review and /audit', () => {
    expect(canAccessRoute('admin_hr', '/review')).toBe(true);
    // HR's audit read is `scoped`, not denied — the item shows, the query narrows (§9.6 ⁶).
    expect(canAccessRoute('admin_hr', '/audit')).toBe(true);
  });

  it('denies an unknown route rather than defaulting open', () => {
    expect(canAccessRoute('super_admin', '/not-a-route' as AppRoute)).toBe(false);
  });
});

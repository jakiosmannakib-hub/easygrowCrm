// components/shell/sidebar.tsx — PUL-110.2, §14.1
//
// Client component: it needs usePathname for the active highlight.
//
// This sidebar is COSMETIC. Hiding an item is not access control — every page enforces its own
// role check via requireRouteAccess (§14.1, §9.5).
//
// There is deliberately NO user-switcher dropdown. The prototype had one; §14.1 and §14.16
// both say it must not ship.

'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/authz';
import { authClient } from '@/lib/auth-client';
import { visibleNavItems } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { NavIcon } from './nav-icon';

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = visibleNavItems(role);

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/sign-in');
  }

  return (
    <aside className="bg-sidebar text-sidebar-foreground flex h-dvh w-60 shrink-0 flex-col border-r">
      <div className="flex h-14 items-center px-4">
        <span className="font-heading text-base font-semibold">EasyGrowCrm</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {items.map((item) => {
          const active = pathname === item.route || pathname.startsWith(`${item.route}/`);
          return (
            <Link
              key={item.route}
              href={item.route}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
              )}
            >
              <NavIcon name={item.icon} className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors"
        >
          <LogOut className="size-4" aria-hidden />
          Logout
        </button>
      </div>
    </aside>
  );
}

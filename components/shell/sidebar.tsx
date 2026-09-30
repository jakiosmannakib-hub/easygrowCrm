// components/shell/sidebar.tsx — PUL-110.2, §14.1 (collapsible since PUL-422)
//
// Client component: it needs usePathname for the active highlight.
//
// This sidebar is COSMETIC. Hiding an item is not access control — every page enforces its own
// role check via requireRouteAccess (§14.1, §9.5).
//
// There is deliberately NO user-switcher dropdown. The prototype had one; §14.1 and §14.16
// both say it must not ship.
//
// PUL-422: two presentations of ONE body.
//   - md and up, an in-flow <aside>: expanded (w-60) or an icon rail (w-16). The width is CSS
//     only, through the `rail:` variant in globals.css (see sidebar-pref.ts for why), and it
//     animates; the main column is a flex sibling, so it reflows instead of being overlapped.
//     In the rail, labels become sr-only text plus a tooltip, and the logo clips to its "e".
//   - below md, the aside is hidden and the header's toggle opens the same body in a left
//     Sheet with full labels. The `rail:` variant only matches inside `[data-app-sidebar]`,
//     and the Sheet portals outside it, so the drawer can never render as a rail.

'use client';

import { authClient } from '@/lib/auth-client';
import type { Role } from '@/lib/authz';
import { visibleNavItems } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { NavIcon } from './nav-icon';
import { useSidebarState } from './sidebar-state';

export function Sidebar({ role }: { role: Role }) {
  const { collapsed, drawerOpen, setDrawerOpen } = useSidebarState();

  return (
    <>
      <aside
        id="app-sidebar"
        data-app-sidebar=""
        className="bg-sidebar text-sidebar-foreground rail:w-16 hidden h-dvh w-60 shrink-0 flex-col overflow-hidden border-r transition-[width] duration-200 ease-in-out motion-reduce:transition-none md:flex"
      >
        {/* Tooltips only while the rail shows; expanded, the label is right there. */}
        <SidebarBody role={role} tooltips={collapsed === true} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          id="app-sidebar-drawer"
          side="left"
          className="bg-sidebar text-sidebar-foreground gap-0 p-0 data-[side=left]:w-60 data-[side=left]:sm:max-w-60"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody role={role} tooltips={false} onNavigate={() => setDrawerOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarBody({
  role,
  tooltips,
  onNavigate,
}: {
  role: Role;
  tooltips: boolean;
  /** The drawer closes on any link click, including the page already showing. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = visibleNavItems(role);

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/sign-in');
  }

  return (
    <TooltipProvider delay={200}>
      <div className="rail:justify-center rail:px-0 flex h-14 shrink-0 items-center gap-2 px-4">
        {/*
          The wordmark is white on transparent: invert it on the light theme. In the rail the
          wrapper clips it to its first glyph, the "e" (12px of the 98px-wide mark at h-4, `w-24.5`), so
          one asset serves both states and the clip animates with the width.
        */}
        <span className="rail:w-3 block w-24.5 overflow-hidden transition-[width] duration-200 ease-in-out motion-reduce:transition-none">
          <Image
            src="/easygrow.webp"
            alt="EasyGrow"
            width={98}
            height={16}
            priority
            className="h-4 w-auto max-w-none invert dark:invert-0"
          />
        </span>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto px-2 py-2">
        {items.map((item) => {
          const active = pathname === item.route || pathname.startsWith(`${item.route}/`);
          return (
            <RailTooltip key={item.route} label={item.label} enabled={tooltips}>
              <Link
                href={item.route}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'rail:justify-center rail:px-0 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground',
                )}
              >
                <NavIcon name={item.icon} className="size-4 shrink-0" />
                {/* sr-only in the rail, so the link keeps its accessible name. */}
                <span className="rail:sr-only truncate">{item.label}</span>
              </Link>
            </RailTooltip>
          );
        })}
      </nav>

      <div className="border-t p-2">
        <RailTooltip label="Logout" enabled={tooltips}>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground rail:justify-center rail:px-0 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors"
          >
            <LogOut className="size-4 shrink-0" aria-hidden />
            <span className="rail:sr-only">Logout</span>
          </button>
        </RailTooltip>
      </div>
    </TooltipProvider>
  );
}

/**
 * A label tooltip to the right of a rail item. Always rendered (so the tree shape never changes
 * between states), and `disabled` while the sidebar is expanded or in the drawer.
 */
function RailTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactElement;
}): ReactNode {
  return (
    <Tooltip disabled={!enabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

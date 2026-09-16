// components/shell/header.tsx — PUL-110.3, §14.1

'use client';

import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ROLE_LABELS, initials } from '@/features/employees/display';
import { PAGE_META, type AppRoute } from '@/lib/nav';
import type { getSessionUser } from '@/lib/session';

/** Just the display fields of the session user — the layout already has them (§9.5). */
type HeaderUser = Pick<Awaited<ReturnType<typeof getSessionUser>>, 'name' | 'image' | 'role'>;

export function Header({ user }: { user: HeaderUser }) {
  const pathname = usePathname();

  // Match the longest route prefix so a future detail page (/projects/42) keeps its header.
  const route = (Object.keys(PAGE_META) as AppRoute[])
    .filter((r) => pathname === r || pathname.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  const meta = route ? PAGE_META[route] : undefined;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
      <div>
        <h1 className="font-heading text-sm font-semibold">{meta?.title ?? 'EasyGrowCrm'}</h1>
        {meta?.subtitle ? (
          <p className="text-muted-foreground text-xs">{meta.subtitle}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {/*
          Bell only. The unread count is hard-coded 0 and there is no panel and no click
          behaviour — the Notifications slide-in panel and its real count land in PUL-802.
        */}
        <div
          className="text-muted-foreground relative flex items-center"
          aria-label="Notifications"
        >
          <Bell className="size-4" aria-hidden />
          <span className="bg-muted text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none">
            0
          </span>
        </div>

        {/*
          Who is signed in. READ-ONLY, deliberately: §14.1 says the prototype's user-switcher
          dropdown must NOT ship, so this is not a button and has no menu. Logout keeps its
          single home at the sidebar bottom and is not duplicated here.

          No fetch and no query — the shell layout already resolved this user via
          getSessionUser() to pick the sidebar's role, and passes the same row down.
        */}
        <div className="flex items-center gap-2.5 border-l pl-4">
          {/* Narrow screens drop the text; the avatar always survives. */}
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight font-medium">{user.name}</p>
            <p className="text-muted-foreground text-xs leading-tight">{ROLE_LABELS[user.role]}</p>
          </div>
          <Avatar size="sm">
            {/*
              A provisioned user who has not signed in yet has no Google image. That is the
              normal state, not an error — the initials fallback is the common path.
            */}
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}

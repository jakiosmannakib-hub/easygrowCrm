// components/shell/header.tsx — PUL-110.3, §14.1

'use client';

import { Bell } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { PAGE_META, type AppRoute } from '@/lib/nav';

export function Header() {
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

      {/*
        Bell only. The unread count is hard-coded 0 and there is no panel and no click
        behaviour — the Notifications slide-in panel and its real count land in PUL-802.
      */}
      <div className="text-muted-foreground relative flex items-center" aria-label="Notifications">
        <Bell className="size-4" aria-hidden />
        <span className="bg-muted text-muted-foreground ml-1.5 rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none">
          0
        </span>
      </div>
    </header>
  );
}

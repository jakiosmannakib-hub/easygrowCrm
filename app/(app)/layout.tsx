// app/(app)/layout.tsx — PUL-110.1
//
// The shell wrapping every app page. /sign-in sits outside this route group, so it renders
// without a sidebar.
//
// DIVISION OF LABOUR: this layout does AUTHENTICATION (are you a valid, active, signed-in
// user?) so the sidebar has a role to render and no page has to repeat it. Each page still
// calls requireRouteAccess for its own ROLE check — a layout cannot know which route rendered
// beneath it, and §9.5 puts the boundary on the page.

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Header } from '@/components/shell/header';
import { Sidebar } from '@/components/shell/sidebar';
import { SidebarStateProvider } from '@/components/shell/sidebar-state';
import { AppError } from '@/lib/errors';
import { getSessionUser } from '@/lib/session';

export default async function AppLayout({ children }: { children: ReactNode }) {
  let user: Awaited<ReturnType<typeof getSessionUser>>;

  try {
    user = await getSessionUser();
  } catch (err) {
    if (err instanceof AppError && (err.code === 'UNAUTHENTICATED' || err.code === 'DEACTIVATED')) {
      redirect('/sign-in');
    }
    throw err;
  }

  // The sidebar and the main column are flex siblings, so when the sidebar narrows to its rail
  // (PUL-422) the main column reflows into the space rather than being overlapped.
  return (
    <SidebarStateProvider>
      <div className="flex h-dvh">
        <Sidebar role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header user={user} />
          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SidebarStateProvider>
  );
}

// app/(app)/dashboard/page.tsx: PUL-110.4; Today's Status card added in PUL-302 Stage 2.
//
// The Today card (§14.2) sits at the top for every role. The rest of the dashboard (Admin /
// Employee branches, PUL-803 / PUL-804) is still the placeholder below it.
//
// Everything the card and its Sign-In dialog show is read here, on the server: client
// components cannot import queries. After a sign-in the dialog calls `router.refresh()`, which
// re-runs this page.

import { TodayCard } from '@/features/attendance/components/today-card';
import { getMyToday, getSignInPrefill } from '@/features/attendance/queries';
import { activeClientsQuery } from '@/features/clients/queries';
import { getSettings, isHoliday } from '@/features/settings/queries';
import { clock } from '@/lib/clock';
import { localDateTime } from '@/lib/format';
import { requireRouteAccess } from '@/lib/route-guard';
import { Placeholder } from '../placeholder';

export default async function DashboardPage() {
  // THE security boundary (§9.5): unauthenticated → /sign-in, wrong role → 404. The sidebar
  // hiding this item is cosmetic and is not access control.
  await requireRouteAccess('/dashboard');

  const settings = await getSettings();
  const localDate = localDateTime(clock.now(), settings.timezone).date;
  const today = await getMyToday();

  // The dialog's data is only needed before sign-in.
  const [prefill, clients, holidayToday] =
    today.attendance === null
      ? await Promise.all([getSignInPrefill(), activeClientsQuery(), isHoliday(localDate)])
      : [[], [], false];

  return (
    <div className="space-y-6">
      <TodayCard
        today={today}
        localDate={localDate}
        signIn={{
          prefill,
          clients,
          holidayToday,
          rules: {
            graceIn: settings.graceIn,
            workDays: settings.workDays,
            timezone: settings.timezone,
          },
        }}
      />
      <Placeholder route="/dashboard" />
    </div>
  );
}

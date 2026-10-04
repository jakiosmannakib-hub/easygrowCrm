// features/attendance/components/today-card.tsx (PUL-302 Stage 2, §14.2 Today's Status card)
//
// The top of /dashboard for every role. Three states, from `getMyToday()`:
//   - not signed in: the local time, one line of help, a big Sign in button;
//   - signed in: when, the work type, Late if so, and today's plan;
//   - signed out: a one-line "Day closed" placeholder (sign-out itself is PUL-305).
//
// Server-authoritative: the page re-reads after sign-in (`router.refresh()`), nothing here is
// optimistic. Times show in `settings.timezone` via `localDateTime`, never the browser's zone.

'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/features/projects/components/status-pill';
import { clock } from '@/lib/clock';
import { fmtClockTime, fmtDate, localDateTime } from '@/lib/format';
import { LATE_PILL_CLASSNAME, OVERDUE_PILL_CLASSNAME, WORK_TYPE_LABELS } from '../display';
import type { MyToday } from '../queries';
import { SignInDialog, type SignInDialogProps } from './sign-in-dialog';

export function TodayCard({
  today,
  localDate,
  signIn,
}: {
  today: MyToday;
  /** Today's local working day, `YYYY-MM-DD`, decided by the server. */
  localDate: string;
  /** Everything the Sign-In dialog needs; read only while not signed in. */
  signIn: Omit<SignInDialogProps, 'open' | 'onOpenChange'>;
}) {
  const { timezone } = signIn.rules;
  const day = today.attendance;
  const at = (instant: Date) => fmtClockTime(localDateTime(instant, timezone).time);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <CardDescription>{fmtDate(localDate, { relative: false })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {day === null ? (
          <NotSignedIn timezone={timezone} signIn={signIn} />
        ) : day.signOutAt !== null ? (
          // Placeholder until PUL-305 builds sign-out and its summary.
          <p className="text-sm">Day closed at {at(day.signOutAt)}.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Signed in at {at(day.signInAt)}</span>
              <span className="text-muted-foreground">· {WORK_TYPE_LABELS[day.workType]}</span>
              {day.late ? (
                <Badge variant="outline" className={LATE_PILL_CLASSNAME}>
                  Late
                </Badge>
              ) : null}
            </div>

            {/* PUL-304: the work timer (getMyTimer) and break controls go here. */}

            <PlanList plan={today.plan} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NotSignedIn({
  timezone,
  signIn,
}: {
  timezone: string;
  signIn: Omit<SignInDialogProps, 'open' | 'onOpenChange'>;
}) {
  const [open, setOpen] = useState(false);
  // The local time, refreshed every 15s. Cosmetic: nothing is decided from it.
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(clock.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-3">
      {/* Server and browser render this a moment apart; the minute may differ. */}
      <p className="font-heading text-3xl tabular-nums" suppressHydrationWarning>
        {fmtClockTime(localDateTime(now, timezone).time)}
      </p>
      <p className="text-muted-foreground text-sm">
        Sign in when you start work. You will confirm today&apos;s plan as you do.
      </p>
      <Button className="h-12 w-full px-8 text-base sm:w-auto" onClick={() => setOpen(true)}>
        Sign in
      </Button>
      <SignInDialog open={open} onOpenChange={setOpen} {...signIn} />
    </div>
  );
}

function PlanList({ plan }: { plan: MyToday['plan'] }) {
  return (
    <section className="space-y-2" aria-labelledby="today-plan-heading">
      <h3 id="today-plan-heading" className="text-sm font-medium">
        Today&apos;s plan
      </h3>
      {plan.length === 0 ? (
        <p className="text-muted-foreground text-xs">No plan for today.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {plan.map((row) => (
            <li key={row.id} className="space-y-1 p-2">
              <p className="text-sm break-words">{row.title}</p>
              <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                {row.projectTaskId !== null ? (
                  <>
                    <span>From {row.projectName}</span>
                    {row.projectTaskStatus !== null ? (
                      <StatusPill status={row.projectTaskStatus} />
                    ) : null}
                    {row.isOverdue ? (
                      <Badge variant="outline" className={OVERDUE_PILL_CLASSNAME}>
                        Overdue
                      </Badge>
                    ) : null}
                  </>
                ) : (
                  <span>{row.clientName ? `Ad-hoc, ${row.clientName}` : 'Ad-hoc'}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

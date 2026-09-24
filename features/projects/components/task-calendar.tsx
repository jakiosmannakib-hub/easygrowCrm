// features/projects/components/task-calendar.tsx — PUL-411, §14.3.4
//
// The Calendar tab: a month grid with each task as a category-colored chip on its due day.
//
// **A presentation, like the Board and the List — it never fetches.** It draws the filter bar's
// `tasks` array. `getFilteredTasks` has no date window, so every matching task is already in
// that array, and Prev / Next just move the viewed month over it. A server-side shift would
// return the same rows (see the §14.3.4 note in §17 / PUL-411).
//
// Grid construction and bucketing are pure helpers in display.ts (`calendarGrid`,
// `bucketTasksByDay`, `shiftCalendarMonth`), unit-tested in `features/projects/calendar.test.ts`.

'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { dhakaToday } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CALENDAR_WEEKDAYS,
  bucketTasksByDay,
  calendarGrid,
  calendarMonthOf,
  calendarMonthTitle,
  categoryDotClass,
  shiftCalendarMonth,
  type CalendarMonth,
} from '../display';
import { TaskDetailModal } from './task-detail-modal';
import type { FilteredTaskRow } from '../queries';

/** Chips shown per day before collapsing the rest into "+N more". */
const DAY_CHIP_CAP = 3;

export function TaskCalendar({
  tasks,
  loading,
  onChanged,
}: {
  /** The filter bar's current `getFilteredTasks` result — the calendar never fetches its own. */
  tasks: FilteredTaskRow[];
  /** True while the filter bar is re-reading. */
  loading: boolean;
  /** Called when the Task Detail modal closes, so the parent re-reads list + header. */
  onChanged: () => void;
}) {
  // One read of "today" per render, from the clock port (§16.6) — the grid's highlight and the
  // starting month both use this string, so they can never disagree.
  const today = dhakaToday();

  /**
   * **The viewed month — the calendar's one piece of navigation state (§16.10).** Declared with a
   * real value from the first render: the current Asia/Dhaka month, derived from `dhakaToday()`
   * rather than from a browser `new Date()`. Prev / Next / Today replace it; nothing lazily
   * creates it.
   */
  const [viewed, setViewed] = useState<CalendarMonth>(() => calendarMonthOf(today));
  /** Which task's detail modal is open. `null` IS the closed state. */
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  /**
   * The one day whose "+N more" has been expanded, or `null`. A single ISO string rather than a
   * set: expanding a second day collapses the first, which keeps the grid's rows from all
   * growing at once. Deliberately not a popover — a day-detail view is not this ticket.
   */
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  if (loading && tasks.length === 0) {
    return (
      <div
        aria-busy
        aria-label="Loading tasks"
        className="bg-muted h-96 animate-pulse rounded-md"
      />
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-muted-foreground border-border rounded-md border border-dashed p-10 text-center text-sm">
        No tasks match these filters.
      </div>
    );
  }

  const weeks = calendarGrid(viewed);
  const byDay = bucketTasksByDay(tasks);
  const undatedCount = tasks.filter((t) => t.dueDate === null).length;
  const current = calendarMonthOf(today);
  const isCurrentMonth = viewed.year === current.year && viewed.month === current.month;

  return (
    <>
      <div
        aria-busy={loading}
        className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">{calendarMonthTitle(viewed)}</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous month"
              onClick={() => setViewed((v) => shiftCalendarMonth(v, -1))}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isCurrentMonth}
              onClick={() => setViewed(current)}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next month"
              onClick={() => setViewed((v) => shiftCalendarMonth(v, 1))}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="border-border min-w-[42rem] overflow-hidden rounded-md border">
            <div className="bg-muted/40 border-border grid grid-cols-7 border-b">
              {CALENDAR_WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="text-muted-foreground px-2 py-1.5 text-[0.625rem] font-medium tracking-wide uppercase"
                >
                  {d}
                </div>
              ))}
            </div>

            {weeks.map((week) => (
              <div
                key={week[0]!.iso}
                className="divide-border border-border grid grid-cols-7 divide-x border-b last:border-b-0"
              >
                {week.map((cell) => {
                  const dayTasks = byDay.get(cell.iso) ?? [];
                  const expanded = expandedDay === cell.iso;
                  const shown = expanded ? dayTasks : dayTasks.slice(0, DAY_CHIP_CAP);
                  const hidden = dayTasks.length - shown.length;
                  const isToday = cell.iso === today;

                  return (
                    <div
                      key={cell.iso}
                      className={cn('min-h-24 space-y-1 p-1.5', !cell.inMonth && 'bg-muted/30')}
                    >
                      {/* §14.3.4: today's date number sits in a solid teal circle. */}
                      <span
                        className={cn(
                          'inline-flex size-5 items-center justify-center rounded-full text-[0.625rem] tabular-nums',
                          isToday
                            ? 'bg-teal-600 font-semibold text-white'
                            : cell.inMonth
                              ? 'text-foreground'
                              : 'text-muted-foreground/60',
                        )}
                        aria-current={isToday ? 'date' : undefined}
                      >
                        {cell.day}
                      </span>

                      {shown.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          title={task.title}
                          onClick={() => setOpenTaskId(task.id)}
                          className={cn(
                            'bg-card border-border hover:border-foreground/30 flex w-full items-center gap-1 rounded border px-1 py-0.5 text-left text-[0.625rem] transition-colors',
                            !cell.inMonth && 'opacity-60',
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn('size-1.5 shrink-0 rounded-full', categoryDotClass(task.category))}
                          />
                          <span className="truncate">{task.title}</span>
                        </button>
                      ))}

                      {/*
                        Expands THIS day in place (and collapses any other). No day-detail
                        popover: the List view is the place to read a busy day in full.
                      */}
                      {dayTasks.length > DAY_CHIP_CAP ? (
                        <button
                          type="button"
                          onClick={() => setExpandedDay(expanded ? null : cell.iso)}
                          className="text-muted-foreground hover:text-foreground px-1 text-[0.625rem]"
                        >
                          {expanded ? 'Show less' : `+${hidden} more`}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Undated tasks have no day to sit on (bucketTasksByDay omits them) — say so, rather
            than let them silently vanish from this tab while Board and List show them. */}
        {undatedCount > 0 ? (
          <p className="text-muted-foreground text-xs">
            {undatedCount} task{undatedCount === 1 ? '' : 's'} without a due date{' '}
            {undatedCount === 1 ? "isn't" : "aren't"} shown on the calendar.
          </p>
        ) : null}
      </div>

      <TaskDetailModal
        taskId={openTaskId ?? ''}
        open={openTaskId !== null}
        onClose={() => {
          setOpenTaskId(null);
          onChanged();
        }}
      />
    </>
  );
}

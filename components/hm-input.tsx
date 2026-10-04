// components/hm-input.tsx (PUL-302 Stage 2, §14.15 r.1)
//
// THE time input: paired Hours + Minutes selects, minutes in 5-minute steps. Value in and out
// is decimal hours (`number | null`), which is what storage holds; rendering elsewhere goes
// through `fmtHM`. The arithmetic lives in hm-input-value.ts (unit-tested).
//
// Shipped with the Sign-In modal's estimate field. Sign-Out's "actual time" (PUL-305) and the
// submit strip (PUL-601) reuse it; existing number inputs are not migrated here.

'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { hourChoices, joinHours, MINUTE_CHOICES, splitHours } from './hm-input-value';

/** The "nothing chosen" item. Not a number, never part of the value. */
const NONE = 'none';

export function HMInput({
  value,
  onChange,
  label,
  id,
  disabled,
  className,
}: {
  value: number | null;
  onChange: (hours: number | null) => void;
  /** What is being timed, e.g. "Estimate". Names both selects for screen readers. */
  label: string;
  /** Put on the Hours trigger, so a visible <Label htmlFor={id}> points at the first select. */
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const parts = splitHours(value);

  function set(next: { hours?: number | null; minutes?: number | null }) {
    onChange(joinHours({ ...parts, ...next }));
  }

  const parse = (v: string | null) => (v === null || v === NONE ? null : Number(v));

  return (
    <div className={cn('grid grid-cols-2 gap-2', className)} role="group" aria-label={label}>
      <Select
        value={parts.hours === null ? NONE : String(parts.hours)}
        onValueChange={(v: string | null) => set({ hours: parse(v) })}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-label={`${label}, hours`}>
          <SelectValue placeholder="Hours">
            {(v: string | null) => (v === null || v === NONE ? 'Hours' : `${v}h`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No hours</SelectItem>
          {hourChoices(parts.hours).map((h) => (
            <SelectItem key={h} value={String(h)}>
              {h}h
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={parts.minutes === null ? NONE : String(parts.minutes)}
        onValueChange={(v: string | null) => set({ minutes: parse(v) })}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" aria-label={`${label}, minutes`}>
          <SelectValue placeholder="Minutes">
            {(v: string | null) => (v === null || v === NONE ? 'Minutes' : `${v}m`)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No minutes</SelectItem>
          {MINUTE_CHOICES.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m}m
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

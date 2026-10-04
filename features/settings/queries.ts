// features/settings/queries.ts
//
// Reads for the settings slice. No 'use server' and no writes: queries may run anywhere; only
// actions.ts writes (CLAUDE.md §2). The editor and its actions land in PUL-903.

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { holidays, settings } from '../../db/schema';
import type { Executor } from '../../lib/mutation';

export type Settings = typeof settings.$inferSelect;

/**
 * The single settings row (§11.8, id always 1). The only source for the attendance rules
 * (§10.1): never a hardcoded constant.
 *
 * Pass the transaction when the caller is inside one, so the read sees the same snapshot as
 * the writes it decides. No caching: one primary-key read, and a PUL-903 edit must take effect
 * on the next request.
 *
 * Migration 0012 seeds the row and nothing deletes it, so a missing row is a broken database,
 * not a user error: a plain Error, not an AppError.
 */
export async function getSettings(exec: Executor = db): Promise<Settings> {
  const [row] = await exec.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) throw new Error('settings row missing: migration 0012 seeds it');
  return row;
}

/** Whether `date` (`YYYY-MM-DD`) is in `holidays` (§11.7). */
export async function isHoliday(date: string, exec: Executor = db): Promise<boolean> {
  const [row] = await exec
    .select({ date: holidays.date })
    .from(holidays)
    .where(eq(holidays.date, date))
    .limit(1);
  return row !== undefined;
}

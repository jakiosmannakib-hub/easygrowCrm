import { sql } from 'drizzle-orm';
import { check, date, integer, pgTable, text, time } from 'drizzle-orm/pg-core';

/**
 * Agency settings (§11.8): a single row, `id` always 1 (`settings_id_check`). The only source
 * for the attendance constants (§10.1); §3.5's hardcoded constants are deleted.
 *
 * §11.9's logical migration 006, shipped as drizzle file 0012_config.sql (PUL-301), which seeds
 * the one row with `company_name = 'My company'` and every other column at its default. PUL-903
 * builds the editor that renames it.
 */
export const settings = pgTable(
  'settings',
  {
    id: integer('id').primaryKey().default(1),
    companyName: text('company_name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Dhaka'),
    /** 0 = Sunday. Sun to Thu. */
    workDays: integer('work_days')
      .array()
      .notNull()
      .default(sql`'{0,1,2,3,4}'`),
    shiftStart: time('shift_start').notNull().default('09:00'),
    shiftEnd: time('shift_end').notNull().default('18:00'),
    graceIn: time('grace_in').notNull().default('09:15'),
    /** 7h net. */
    workTargetMin: integer('work_target_min').notNull().default(420),
    /** 3.5h. */
    halfTargetMin: integer('half_target_min').notNull().default(210),
    breakAllowanceMin: integer('break_allowance_min').notNull().default(60),
    halfBreakAllowanceMin: integer('half_break_allowance_min').notNull().default(30),
    autoCloseHours: integer('auto_close_hours').notNull().default(10),
    /** The Discord webhook URL. */
    webhookUrl: text('webhook_url'),
  },
  // §11.8's check is inline and unnamed; named explicitly with the name Postgres would give it.
  (table) => [check('settings_id_check', sql`${table.id} = 1`)],
);

/** Bangladesh public holidays (§11.7). Leave and working-day math skip these dates. No seed. */
export const holidays = pgTable('holidays', {
  date: date('date').primaryKey(),
  name: text('name').notNull(),
});

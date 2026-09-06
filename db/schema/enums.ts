import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', [
  'super_admin',
  'team_leader',
  'project_manager',
  'admin_hr',
  'employee',
]);
export const taskStatus = pgEnum('task_status', [
  'planned',
  'in_progress',
  'blocked',
  'submitted',
  'revision_required',
  'approved',
  'completed',
  'cancelled',
]);
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent']);
export const reviewDecision = pgEnum('review_decision', ['approved', 'revision_requested']);
export const workType = pgEnum('work_type', ['in_office', 'remote', 'client_site']);
export const breakType = pgEnum('break_type', [
  'lunch',
  'prayer',
  'personal',
  'meeting',
  'internet_issue',
  'power_issue',
  'emergency',
  'other',
]);
export const signoutType = pgEnum('signout_type', ['normal', 'early', 'auto_closed', 'half_day']);
export const leaveType = pgEnum('leave_type', [
  'sick',
  'casual',
  'emergency',
  'half_day',
  'wfh',
  'late_arrival',
  'early_leave',
  'overtime',
]);
export const leaveStatus = pgEnum('leave_status', ['pending', 'approved', 'rejected']);
export const halfSelection = pgEnum('half_selection', ['first_half', 'second_half']);
export const proofType = pgEnum('proof_type', [
  'url',
  'google_doc',
  'google_sheet',
  'screenshot',
  'file',
  'loom',
  'staging_url',
  'published_url',
  'report',
  'other',
]);
export const dailyTaskStatus = pgEnum('daily_task_status', [
  'planned',
  'in_progress',
  'done',
  'partially_done',
  'pending',
  'blocked',
]);
export const projectStatus = pgEnum('project_status', ['active', 'archived']);

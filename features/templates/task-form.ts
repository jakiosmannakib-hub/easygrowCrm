// features/templates/task-form.ts — PUL-503 Stage 3b
//
// The pure half of the §14.4.4 Add/Edit Task modal: the form's state shape, how a stored task
// seeds it, and how it converts back into the fields `addTemplateTask` / `updateTemplateTask`
// take. No React and no I/O, so it is unit-tested directly (task-form.test.ts); the modal is
// just inputs bound to this state.
//
// Every input value is a string (or a boolean for the checkboxes), because that is what inputs
// give back. `formToTaskFields` does the one conversion to wire types, and reports per-field
// errors rather than throwing.

import { taskPriority } from '../../db/schema/enums';
import type { DueRule } from '../../db/schema/templates';
import type { TemplateTaskNode } from './hierarchy';

export type TaskPriority = (typeof taskPriority.enumValues)[number];
export type DueKind = DueRule['kind'];

/** One row of the modal's live subtask list. `key` is React's; `id` exists once saved. */
export interface SubtaskDraft {
  key: string;
  id?: string;
  title: string;
}

export interface TaskFormState {
  title: string;
  /** `''` = no role. */
  roleHint: string;
  priority: TaskPriority;
  dueKind: DueKind;
  /** N for `day` / `before_deadline`, as typed. */
  dueN: string;
  /** The referenced task id for `after`; `''` until one is picked. */
  dueRef: string;
  /** Decimal hours as typed; `''` = no estimate. */
  estHours: string;
  proofRequired: boolean;
  clientVisible: boolean;
  sopUrl: string;
  expectedOutput: string;
  /** The checklist textarea: one item per line. */
  checklist: string;
  subtasks: SubtaskDraft[];
}

/** What both task actions accept, minus the target id and the subtask shape. */
export interface TaskFields {
  title: string;
  roleHint: string | null;
  priority: TaskPriority;
  estHours: number | null;
  dueRule: DueRule;
  proofRequired: boolean;
  clientVisible: boolean;
  sopUrl: string | null;
  expectedOutput: string | null;
  checklist: string[];
  subtasks: Array<{ id?: string; title: string }>;
}

export type TaskFormResult =
  | { ok: true; fields: TaskFields }
  | { ok: false; errors: Partial<Record<keyof TaskFormState, string>> };

/**
 * The checklist textarea → `string[]`: one item per line, each trimmed, blank lines dropped.
 * Handles `\r\n` as well as `\n`, since a pasted list may carry either.
 */
export function parseChecklist(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The inverse, for seeding the textarea from a stored task. */
export function checklistToText(items: readonly string[]): string {
  return items.join('\n');
}

/**
 * The form's starting state. `null` = a new task: the column defaults of §11.4 (priority medium,
 * proof and client-visible off; QC is not a form field since Amendment M, PUL-416) and a `Day 1`
 * rule.
 */
export function initialTaskForm(task: TemplateTaskNode | null): TaskFormState {
  if (!task) {
    return {
      title: '',
      roleHint: '',
      priority: 'medium',
      dueKind: 'day',
      dueN: '1',
      dueRef: '',
      estHours: '',
      proofRequired: false,
      clientVisible: false,
      sopUrl: '',
      expectedOutput: '',
      checklist: '',
      subtasks: [],
    };
  }

  const rule = task.dueRule;
  return {
    title: task.title,
    roleHint: task.roleHint ?? '',
    priority: task.priority,
    dueKind: rule.kind,
    dueN: rule.kind === 'after' ? '1' : String(rule.n),
    dueRef: rule.kind === 'after' ? rule.ref : '',
    // `numeric` reads back as "1.50"; Number() drops the trailing zeros for the input.
    estHours: task.estHours === null ? '' : String(Number(task.estHours)),
    proofRequired: task.proofRequired,
    clientVisible: task.clientVisible,
    sopUrl: task.sopUrl ?? '',
    expectedOutput: task.expectedOutput ?? '',
    checklist: checklistToText(task.checklist),
    subtasks: task.subtasks.map((s) => ({ key: s.id, id: s.id, title: s.title })),
  };
}

/** `''` (after trimming) → `null`, otherwise the trimmed text. */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Convert the form to the action fields, or report what is wrong with it. The server re-parses
 * all of this with the zod schemas and remains the real gate (§9.5 rule 2); the `after` ref's
 * validity (same template, no cycle) is ONLY decided there (`GATE:bad_ref`).
 */
export function formToTaskFields(state: TaskFormState): TaskFormResult {
  const errors: Partial<Record<keyof TaskFormState, string>> = {};

  const title = state.title.trim();
  if (!title) errors.title = 'Give the task a title.';

  let dueRule: DueRule | undefined;
  if (state.dueKind === 'after') {
    if (!state.dueRef) errors.dueRef = 'Pick the task this one comes after.';
    else dueRule = { kind: 'after', ref: state.dueRef };
  } else {
    const n = Number(state.dueN.trim());
    if (state.dueN.trim() === '' || !Number.isInteger(n) || n < 0) {
      errors.dueN = 'Enter a whole number of days, 0 or more.';
    } else {
      dueRule = { kind: state.dueKind, n };
    }
  }

  let estHours: number | null = null;
  if (state.estHours.trim() !== '') {
    const hours = Number(state.estHours.trim());
    if (!Number.isFinite(hours) || hours < 0 || hours > 9999.99) {
      errors.estHours = 'Enter hours as a number, for example 1.5.';
    } else {
      estHours = hours;
    }
  }

  const subtasks = state.subtasks
    .map((s) => ({ ...(s.id ? { id: s.id } : {}), title: s.title.trim() }))
    .filter((s) => s.title.length > 0);

  if (Object.keys(errors).length > 0 || !dueRule) return { ok: false, errors };

  return {
    ok: true,
    fields: {
      title,
      roleHint: textOrNull(state.roleHint),
      priority: state.priority,
      estHours,
      dueRule,
      proofRequired: state.proofRequired,
      clientVisible: state.clientVisible,
      sopUrl: textOrNull(state.sopUrl),
      expectedOutput: textOrNull(state.expectedOutput),
      checklist: parseChecklist(state.checklist),
      subtasks,
    },
  };
}

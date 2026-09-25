// features/templates/task-form.test.ts — PUL-503 Stage 3b
//
// The pure half of the §14.4.4 task modal: the checklist parse and the form ⇄ action-fields
// conversion. PURE test: no db module, no `assertTestDb`.

import { describe, expect, it } from 'vitest';
import type { TemplateTaskNode } from './hierarchy';
import {
  checklistToText,
  formToTaskFields,
  initialTaskForm,
  parseChecklist,
  type TaskFormState,
} from './task-form';

function stored(overrides: Partial<TemplateTaskNode> = {}): TemplateTaskNode {
  return {
    id: 'tt_1',
    categoryId: 'tcat_1',
    position: 1,
    title: 'Audit {{ClientName}} GBP',
    roleHint: 'SEO Executive',
    priority: 'high',
    estHours: '1.50',
    dueRule: { kind: 'before_deadline', n: 3 },
    qcRequired: false,
    proofRequired: true,
    clientVisible: true,
    sopUrl: 'https://sop.example/gbp',
    expectedOutput: 'Audit sheet',
    checklist: ['Photos', 'Hours'],
    subtasks: [
      { id: 'tts_a', taskId: 'tt_1', title: 'A', position: 1 },
      { id: 'tts_b', taskId: 'tt_1', title: 'B', position: 2 },
    ],
    ...overrides,
  };
}

function form(overrides: Partial<TaskFormState> = {}): TaskFormState {
  return { ...initialTaskForm(null), title: 'Task', ...overrides };
}

describe('parseChecklist', () => {
  it('splits on newlines, trims each item, and drops blank lines', () => {
    expect(parseChecklist('  Title tag \n\nMeta description\n   \nH1\n')).toEqual([
      'Title tag',
      'Meta description',
      'H1',
    ]);
  });

  it('handles Windows line endings', () => {
    expect(parseChecklist('One\r\nTwo\r\n')).toEqual(['One', 'Two']);
  });

  it('returns [] for an empty or whitespace-only textarea', () => {
    expect(parseChecklist('')).toEqual([]);
    expect(parseChecklist(' \n \n')).toEqual([]);
  });

  it('round-trips with checklistToText', () => {
    const items = ['Photos', 'Hours', 'Categories'];
    expect(parseChecklist(checklistToText(items))).toEqual(items);
  });
});

describe('initialTaskForm', () => {
  it('uses the §11.4 defaults for a new task', () => {
    expect(initialTaskForm(null)).toMatchObject({
      priority: 'medium',
      dueKind: 'day',
      dueN: '1',
      qcRequired: true,
      proofRequired: false,
      clientVisible: false,
      subtasks: [],
    });
  });

  it('seeds every field from a stored task, subtasks keyed by id', () => {
    expect(initialTaskForm(stored())).toMatchObject({
      title: 'Audit {{ClientName}} GBP',
      roleHint: 'SEO Executive',
      priority: 'high',
      dueKind: 'before_deadline',
      dueN: '3',
      estHours: '1.5',
      qcRequired: false,
      proofRequired: true,
      clientVisible: true,
      sopUrl: 'https://sop.example/gbp',
      expectedOutput: 'Audit sheet',
      checklist: 'Photos\nHours',
      subtasks: [
        { key: 'tts_a', id: 'tts_a', title: 'A' },
        { key: 'tts_b', id: 'tts_b', title: 'B' },
      ],
    });
  });

  it('seeds an after rule into dueRef', () => {
    const state = initialTaskForm(stored({ dueRule: { kind: 'after', ref: 'tt_0' } }));
    expect(state).toMatchObject({ dueKind: 'after', dueRef: 'tt_0' });
  });
});

describe('formToTaskFields', () => {
  it('round-trips a stored task unchanged, keeping the title token verbatim', () => {
    const result = formToTaskFields(initialTaskForm(stored()));
    expect(result).toEqual({
      ok: true,
      fields: {
        title: 'Audit {{ClientName}} GBP',
        roleHint: 'SEO Executive',
        priority: 'high',
        estHours: 1.5,
        dueRule: { kind: 'before_deadline', n: 3 },
        qcRequired: false,
        proofRequired: true,
        clientVisible: true,
        sopUrl: 'https://sop.example/gbp',
        expectedOutput: 'Audit sheet',
        checklist: ['Photos', 'Hours'],
        subtasks: [
          { id: 'tts_a', title: 'A' },
          { id: 'tts_b', title: 'B' },
        ],
      },
    });
  });

  it('turns blank optional text into null and a blank estimate into null', () => {
    const result = formToTaskFields(form({ roleHint: ' ', sopUrl: '', expectedOutput: '  ' }));
    expect(result.ok && result.fields).toMatchObject({
      roleHint: null,
      sopUrl: null,
      expectedOutput: null,
      estHours: null,
    });
  });

  it('keeps new subtasks without an id, in list order, and drops blank ones', () => {
    const result = formToTaskFields(
      form({
        subtasks: [
          { key: 'tts_a', id: 'tts_a', title: 'Kept' },
          { key: 'new-1', title: ' Added ' },
          { key: 'new-2', title: '   ' },
        ],
      }),
    );
    expect(result.ok && result.fields.subtasks).toEqual([
      { id: 'tts_a', title: 'Kept' },
      { title: 'Added' },
    ]);
  });

  it('builds each due-rule kind', () => {
    const day = formToTaskFields(form({ dueKind: 'day', dueN: '5' }));
    const before = formToTaskFields(form({ dueKind: 'before_deadline', dueN: '0' }));
    const after = formToTaskFields(form({ dueKind: 'after', dueRef: 'tt_9' }));
    expect(day.ok && day.fields.dueRule).toEqual({ kind: 'day', n: 5 });
    expect(before.ok && before.fields.dueRule).toEqual({ kind: 'before_deadline', n: 0 });
    expect(after.ok && after.fields.dueRule).toEqual({ kind: 'after', ref: 'tt_9' });
  });

  it('reports each invalid field instead of producing fields', () => {
    const result = formToTaskFields(
      form({ title: '  ', dueKind: 'day', dueN: '2.5', estHours: 'abc' }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['dueN', 'estHours', 'title']);
  });

  it('rejects a negative N and an after rule with no task picked', () => {
    expect(formToTaskFields(form({ dueN: '-1' })).ok).toBe(false);
    const after = formToTaskFields(form({ dueKind: 'after', dueRef: '' }));
    expect(!after.ok && after.errors.dueRef).toBeTruthy();
  });
});

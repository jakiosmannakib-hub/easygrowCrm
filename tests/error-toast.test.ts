// tests/error-toast.test.ts — PUL-106
//
// Not a §15.4 mandatory test. It guards the one place user-facing error wording is decided,
// including the two rules §14.15 r.3 actually states: GATE names the blocked thing, and
// CONFLICT — and only CONFLICT — offers refresh.

import { describe, expect, it } from 'vitest';
import { errorToToast, GATE_REASONS } from '../lib/error-toast';
import { AppError } from '../lib/errors';

describe('errorToToast — per-code defaults', () => {
  it('UNAUTHENTICATED', () => {
    expect(errorToToast({ code: 'UNAUTHENTICATED' })).toEqual({
      message: 'Please sign in again.',
      refresh: false,
    });
  });

  it('DEACTIVATED', () => {
    expect(errorToToast({ code: 'DEACTIVATED' }).message).toBe('This account has been deactivated.');
  });

  it('FORBIDDEN', () => {
    expect(errorToToast({ code: 'FORBIDDEN' }).message).toBe("You don't have permission to do that.");
  });

  it('NOT_FOUND', () => {
    expect(errorToToast({ code: 'NOT_FOUND' }).message).toBe('That item no longer exists.');
  });

  it('ignores a server message on the fixed-wording codes, so internals cannot leak', () => {
    const leaky = { code: 'FORBIDDEN', message: 'user 7f3a lacks project.update on project 91' };

    expect(errorToToast(leaky).message).toBe("You don't have permission to do that.");
  });

  it('VALIDATION prefers the server message', () => {
    expect(errorToToast({ code: 'VALIDATION', message: 'Estimated hours must be > 0.' }).message).toBe(
      'Estimated hours must be > 0.',
    );
  });

  it('VALIDATION falls back when there is no message', () => {
    expect(errorToToast({ code: 'VALIDATION' }).message).toBe('Please check the form and try again.');
  });

  it('an unrecognised code never surfaces a raw internal message', () => {
    const weird = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:5432' };

    expect(errorToToast(weird)).toEqual({
      message: 'Something went wrong. Please try again.',
      refresh: false,
    });
  });
});

describe('errorToToast — GATE reasons (§14.15 r.3: name the blocked thing)', () => {
  it('resolves a known reason from the registry', () => {
    expect(errorToToast({ code: 'GATE', reason: 'checklist_incomplete' }).message).toBe(
      GATE_REASONS.checklist_incomplete,
    );
  });

  it('reads the reason out of meta as well as off the top level', () => {
    expect(errorToToast({ code: 'GATE', meta: { reason: 'last_managers' } }).message).toBe(
      GATE_REASONS.last_managers,
    );
  });

  it('reads the reason off a real AppError via its getter', () => {
    const err = new AppError('GATE', undefined, { reason: 'pending_reviews' });

    expect(errorToToast(err).message).toBe(GATE_REASONS.pending_reviews);
  });

  it('an unknown reason falls back to the server message', () => {
    const err = { code: 'GATE', reason: 'invented_later', message: 'Task 12 is blocked by task 9.' };

    expect(errorToToast(err).message).toBe('Task 12 is blocked by task 9.');
  });

  it('an unknown reason with no message falls back to the generic gate line', () => {
    expect(errorToToast({ code: 'GATE', reason: 'invented_later' }).message).toBe('This action is blocked.');
  });

  it('every seeded reason names something specific, not a generic line', () => {
    for (const [reason, message] of Object.entries(GATE_REASONS)) {
      expect(message, reason).not.toBe('This action is blocked.');
      expect(message.length, reason).toBeGreaterThan(20);
    }
  });

  it('task_has_dependents names the blocking task from the details (PUL-503)', () => {
    // The shape showErrorToast forwards: the ActionResult's `details` arrive as `meta`.
    const toast = errorToToast({
      code: 'GATE',
      reason: 'task_has_dependents',
      message: '"Build citations" is scheduled after a task being deleted',
      meta: { taskIds: ['tt_1', 'tt_2'], titles: ['Build citations', 'Report'] },
    });

    expect(toast.message).toContain('Build citations');
    expect(toast.message).not.toBe(GATE_REASONS.task_has_dependents);
  });

  it('task_has_dependents without titles falls back to the registry sentence', () => {
    expect(errorToToast({ code: 'GATE', reason: 'task_has_dependents' }).message).toBe(
      GATE_REASONS.task_has_dependents,
    );
  });
});

describe('errorToToast — refresh is CONFLICT-only (§14.15 r.3)', () => {
  it('CONFLICT sets refresh and prefers the server message', () => {
    expect(errorToToast({ code: 'CONFLICT', message: 'Someone else updated this task.' })).toEqual({
      message: 'Someone else updated this task.',
      refresh: true,
    });
  });

  it('CONFLICT falls back to the default wording', () => {
    expect(errorToToast({ code: 'CONFLICT' })).toEqual({
      message: 'This changed while you were editing. Refresh to see the latest.',
      refresh: true,
    });
  });

  it('no other code offers refresh', () => {
    const others = ['UNAUTHENTICATED', 'DEACTIVATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION', 'GATE'];

    for (const code of others) {
      expect(errorToToast({ code }).refresh, code).toBe(false);
    }
  });
});

describe('AppError.reason', () => {
  it('returns the meta reason', () => {
    expect(new AppError('GATE', undefined, { reason: 'proof_required' }).reason).toBe('proof_required');
  });

  it('is undefined when meta is absent or the reason is not a string', () => {
    expect(new AppError('CONFLICT').reason).toBeUndefined();
    expect(new AppError('GATE', undefined, { reason: 42 }).reason).toBeUndefined();
  });
});

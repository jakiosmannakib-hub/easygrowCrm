// tests/notifications.test.ts — PUL-107
//
// Not a §15.4 mandatory test: it guards the helper the mandatory tests will lean on.

import { beforeEach, describe, expect, it } from 'vitest';
import { __resetNotifications, __sentNotifications, notify } from '../lib/notifications';
import { expectNotified } from './notifications';

beforeEach(() => {
  __resetNotifications();
});

describe('notify (stub adapter)', () => {
  it('records the call', async () => {
    await notify({ to: 'u1', type: 'task_approved', data: { taskId: 't1' } });

    const sent = __sentNotifications();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'u1', type: 'task_approved', data: { taskId: 't1' } });
    expect(typeof sent[0].sentAt).toBe('number');
  });

  it('__resetNotifications clears the log', async () => {
    await notify({ to: 'u1', type: 'task_assigned' });
    expect(__sentNotifications()).toHaveLength(1);

    __resetNotifications();
    expect(__sentNotifications()).toHaveLength(0);
  });

  it('does not hand out the live array', async () => {
    await notify({ to: 'u1', type: 'task_assigned' });
    const snapshot = __sentNotifications();
    await notify({ to: 'u2', type: 'task_submitted' });

    expect(snapshot).toHaveLength(1);
  });
});

describe('expectNotified', () => {
  it('passes on a matching type', async () => {
    await notify({ to: 'u1', type: 'leave_decided', data: { requestId: 'r1', decision: 'approved' } });

    expect(() => expectNotified('u1', { type: 'leave_decided' })).not.toThrow();
  });

  it('matches a data subset, ignoring extra payload keys', async () => {
    await notify({ to: 'u1', type: 'leave_decided', data: { requestId: 'r1', decision: 'approved' } });

    expect(() => expectNotified('u1', { data: { decision: 'approved' } })).not.toThrow();
  });

  it('accepts a predicate matcher', async () => {
    await notify({ to: 'u1', type: 'task_revision', data: { taskId: 't9' } });

    expect(() => expectNotified('u1', (n) => n.data?.taskId === 't9')).not.toThrow();
  });

  it('throws when the type does not match, listing what was sent', async () => {
    await notify({ to: 'u1', type: 'task_assigned', data: { taskId: 't1' } });

    let message = '';
    try {
      expectNotified('u1', { type: 'task_approved' });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain('no notification to "u1" matched');
    // The failure lists what *was* sent, so the diagnosis is in the error itself.
    expect(message).toContain('task_assigned');
    expect(message).toContain('t1');
  });

  it('throws when the recipient does not match', async () => {
    await notify({ to: 'u1', type: 'task_assigned' });

    expect(() => expectNotified('u2', { type: 'task_assigned' })).toThrowError(/no notification to "u2"/);
  });

  it('throws when a data value differs', async () => {
    await notify({ to: 'u1', type: 'leave_decided', data: { decision: 'rejected' } });

    expect(() => expectNotified('u1', { data: { decision: 'approved' } })).toThrowError(/expectNotified/);
  });

  it('throws when nothing was sent at all', () => {
    expect(() => expectNotified('u1', { type: 'task_assigned' })).toThrowError(/nothing was sent/);
  });
});

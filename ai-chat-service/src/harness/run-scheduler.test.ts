import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { up as migrate } from '../conversation/migrations/010-harness-scheduler.js';
import { HarnessRunScheduler } from './run-scheduler.js';

function request(runId: string) {
  return {
    runId,
    ownerType: 'chat' as const,
    ownerId: `session-${runId}`,
    messageId: `message-${runId}`,
  };
}

describe('HarnessRunScheduler', () => {
  it('shares a bounded permit pool and promotes queued runs in FIFO order', async () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const scheduler = new HarnessRunScheduler(db, 2, 2);

    expect(scheduler.enqueue(request('run-1'))).toBe('active');
    expect(scheduler.enqueue(request('run-2'))).toBe('active');
    expect(scheduler.enqueue(request('run-3'))).toBe('queued');
    expect(scheduler.enqueue(request('run-4'))).toBe('queued');
    expect(() => scheduler.enqueue(request('run-5'))).toThrow('queue is full');

    const third = vi.fn();
    const fourth = vi.fn();
    void scheduler.wait('run-3').then(third);
    void scheduler.wait('run-4').then(fourth);
    await Promise.resolve();
    expect(third).not.toHaveBeenCalled();

    scheduler.complete('run-2');
    await vi.waitFor(() => expect(third).toHaveBeenCalledOnce());
    expect(fourth).not.toHaveBeenCalled();
    scheduler.complete('run-1');
    await vi.waitFor(() => expect(fourth).toHaveBeenCalledOnce());

    scheduler.close();
    db.close();
  });

  it('cancels stale owners at startup and rejects identity drift', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const first = new HarnessRunScheduler(db, 1, 2);
    first.enqueue(request('stale'));

    const restarted = new HarnessRunScheduler(db, 1, 2);
    expect(
      db.prepare('SELECT status FROM harness_model_runs WHERE run_id = ?').get('stale')
    ).toEqual({ status: 'cancelled' });
    expect(() => restarted.enqueue({ ...request('stale'), ownerId: 'different-session' })).toThrow(
      'identity is immutable'
    );

    first.close();
    restarted.close();
    db.close();
  });
});

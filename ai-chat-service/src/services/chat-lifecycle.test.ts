import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationDatabase } from '../db/ConversationDatabase.js';
import { OptimisticLockError } from '../db/SessionStateDAO.js';
import type { AgentState, SessionStatus } from '../db/types.js';
import { ChatSessionController } from './chat-session-controller.js';

const databases: ConversationDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function fixture() {
  const db = new ConversationDatabase();
  databases.push(db);
  db.initialize(':memory:');
  db.createSession({ id: 'chat', title: 'chat', provider: 'test', model: 'test' });
  return { db, controller: new ChatSessionController(db) };
}

describe('durable Chat lifecycle', () => {
  const diagnostic: AgentState = { schema_version: 1, blockReason: 'job_error', retryCount: 1 };
  it('reads persisted lifecycle rather than an in-memory default', async () => {
    const { db, controller } = fixture();
    await db.getSessionStateDAO().create({
      sessionId: 'chat',
      status: 'blocked',
      jobId: 'persisted-run',
      agentState: { schema_version: 1, blockReason: 'api_error' },
    });
    expect(await controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      currentJobId: 'persisted-run',
    });
  });

  it('cleanup releases execution resources without changing cancelled lifecycle', async () => {
    const { db, controller } = fixture();
    await db.getSessionStateDAO().get('chat');
    await controller.beginRun('chat', 'run-1');
    await controller.createAbortController('chat', 'run-1');
    await controller.cancel('chat');
    await controller.cleanup('chat', 'run-1');
    expect((await db.getSessionStateDAO().get('chat'))?.status).toBe('cancelled');
    expect((await controller.getStatus('chat')).status).toBe('cancelled');
  });

  it.each(['paused', 'interrupted', 'cancelled', 'completed', 'blocked'] as SessionStatus[])(
    'keeps %s and its diagnostic during resource cleanup',
    async (status) => {
      const { db, controller } = fixture();
      await controller.beginRun('chat', 'run-1');
      const abort = await controller.createAbortController('chat', 'run-1');
      controller.recordRetry('chat', 'run-1', diagnostic);
      if (status === 'paused') controller.markAsPaused('chat', 'run-1');
      if (status === 'interrupted') await controller.interrupt('chat');
      if (status === 'cancelled') await controller.cancel('chat');
      if (status === 'completed') controller.complete('chat', 'run-1');
      if (status === 'blocked') controller.block('chat', 'run-1', diagnostic);
      await controller.cleanup('chat', 'run-1');
      const state = await db.getSessionStateDAO().get('chat');
      expect(state?.status).toBe(status);
      expect(state?.agentState).toEqual(status === 'completed' ? undefined : diagnostic);
      expect(abort.signal.aborted).toBe(status === 'interrupted' || status === 'cancelled');
    }
  );

  it('an old run cannot retry, settle, pause, or remove the new abort handle', async () => {
    const { controller } = fixture();
    await controller.beginRun('chat', 'old');
    await controller.createAbortController('chat', 'old');
    await controller.cancel('chat');
    await controller.beginRun('chat', 'new');
    const abort = await controller.createAbortController('chat', 'new');
    expect(controller.complete('chat', 'old')).toBe(false);
    expect(controller.block('chat', 'old', diagnostic)).toBe(false);
    expect(controller.recordRetry('chat', 'old', diagnostic)).toBe(false);
    expect(controller.markAsPaused('chat', 'old')).toBe(false);
    await controller.cleanup('chat', 'old');
    expect(await controller.getStatus('chat')).toMatchObject({ status: 'running', jobId: 'new' });
    await controller.interrupt('chat');
    expect(abort.signal.aborted).toBe(true);
  });

  it('recovers only running sessions and retains the persisted diagnostic', async () => {
    const { db, controller } = fixture();
    await controller.beginRun('chat', 'run-1');
    controller.recordRetry('chat', 'run-1', diagnostic);
    expect(await new ChatSessionController(db).recoverRunningSessions()).toEqual(['chat']);
    expect(await controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: diagnostic,
    });
    expect(await controller.recoverRunningSessions()).toEqual([]);
    await controller.beginRun('chat', 'resumed', true);
    expect((await controller.getStatus('chat')).agentState).toBeUndefined();
    controller.recordRetry('chat', 'resumed', diagnostic);
    controller.complete('chat', 'resumed');
    expect((await controller.getStatus('chat')).agentState).toBeUndefined();
  });

  it('preserves undefined, clears null and replaces an object diagnostic', async () => {
    const { db, controller } = fixture();
    await controller.beginRun('chat', 'run-1');
    const dao = db.getSessionStateDAO();
    await dao.update('chat', { agentState: diagnostic });
    await dao.update('chat', { agentState: undefined, lastActiveAt: '2026-10-01T00:00:00.000Z' });
    expect((await dao.get('chat'))?.agentState).toEqual(diagnostic);
    await dao.update('chat', { agentState: null });
    expect((await dao.get('chat'))?.agentState).toBeUndefined();
    const replacement: AgentState = { schema_version: 1, blockReason: 'rate_limit' };
    const before = await dao.get('chat');
    await dao.update('chat', { agentState: replacement }, before?.version);
    expect((await dao.get('chat'))?.agentState).toEqual(replacement);
    await expect(dao.update('chat', { agentState: null }, before?.version)).rejects.toBeInstanceOf(
      OptimisticLockError
    );
  });

  it('enforces transition gates and binds pause flags to the current run', async () => {
    const { controller } = fixture();
    await expect(controller.getStatus('missing')).rejects.toThrow('Session not found');
    await expect(controller.pause('chat')).rejects.toThrow('Cannot pause');
    await expect(controller.interrupt('chat')).rejects.toThrow('Cannot interrupt');
    await expect(controller.cancel('chat')).rejects.toThrow('Cannot cancel');
    await expect(controller.beginRun('chat', 'resume', true)).rejects.toThrow('Cannot resume');
    expect(() => controller.setPauseFlags('chat', { pauseAfterExecution: true })).toThrow(
      'has not started'
    );
    await controller.beginRun('chat', 'run-1');
    await expect(controller.beginRun('chat', 'duplicate')).rejects.toThrow('Cannot start');
    controller.setPauseFlags('chat', { pauseAfterExecution: true });
    expect(controller.shouldPause('chat', 'run-1', 'afterExecution')).toBe(true);
    expect(controller.shouldPause('chat', 'old', 'afterExecution')).toBe(false);
    await controller.pause('chat');
    expect(controller.shouldPause('chat', 'run-1', 'afterGeneration')).toBe(true);
    controller.markAsPaused('chat', 'run-1');
    await controller.cleanup('chat', 'run-1');
    await controller.beginRun('chat', 'resume', true);
    expect(controller.shouldPause('chat', 'resume', 'afterGeneration')).toBe(false);
    expect(controller.shouldPause('chat', 'resume', 'afterExecution')).toBe(true);
    controller.complete('chat', 'resume');
    await controller.cleanup('chat', 'resume');
    expect(controller.shouldPause('chat', 'resume', 'afterExecution')).toBe(false);
    expect(controller.getOperations('chat').length).toBeGreaterThan(0);
    const info = vi.fn();
    await new ChatSessionController(fixture().db, { info } as never).initialize();
    expect(info).toHaveBeenCalled();
  });
});

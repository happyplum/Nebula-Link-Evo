import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from '../../../conversation/manager.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { ChatSessionController } from '../../../services/chat-session-controller.js';
import { SessionLock } from '../../../services/session-lock.js';

describe('session lease recovery contract', () => {
  let sessionLock: SessionLock;

  beforeEach(() => {
    sessionLock = SessionLock.getInstance();
    sessionLock.clear();
  });

  afterEach(() => {
    sessionLock.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('recovers from expired lease and prevents stale run release from ghost-unlocking new owner', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const sessionId = 'lease-recovery-session';
    const staleRunId = `stale-${randomUUID()}`;
    const recoveredRunId = `recovered-${randomUUID()}`;

    expect(sessionLock.acquire(sessionId, staleRunId)).toBe(true);
    expect(sessionLock.getRunId(sessionId)).toBe(staleRunId);

    const renewalIntervalId = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
    clearInterval(renewalIntervalId);

    vi.advanceTimersByTime(31_000);
    vi.runOnlyPendingTimers();

    expect(sessionLock.isLocked(sessionId)).toBe(false);
    expect(sessionLock.acquire(sessionId, recoveredRunId)).toBe(true);
    expect(sessionLock.getRunId(sessionId)).toBe(recoveredRunId);

    sessionLock.release(sessionId, staleRunId);
    expect(sessionLock.isLocked(sessionId)).toBe(true);
    expect(sessionLock.getRunId(sessionId)).toBe(recoveredRunId);

    sessionLock.release(sessionId, recoveredRunId);
    expect(sessionLock.isLocked(sessionId)).toBe(false);
  });
});

describe('chat session controller cleanup contract', () => {
  let manager: ConversationManager;
  let controller: ChatSessionController;

  beforeEach(() => {
    DatabaseManager.resetInstance();
    manager = new ConversationManager(':memory:');
    manager.initialize();
    controller = ChatSessionController.getInstance();
  });

  afterEach(async () => {
    await manager.close();
    DatabaseManager.resetInstance();
  });

  it('transitions interrupted session to idle on cleanup', async () => {
    const session = manager.createSession({
      title: 'interrupted-cleanup',
      provider: 'test',
      model: 'test-model',
    });

    controller.createAbortController(session.id);
    await controller.interrupt(session.id);
    expect(controller.getStatus(session.id).status).toBe('interrupted');

    controller.cleanup(session.id);
    expect(controller.getStatus(session.id).status).toBe('idle');
  });

  it('transitions cancelled session to idle on cleanup', async () => {
    const session = manager.createSession({
      title: 'cancelled-cleanup',
      provider: 'test',
      model: 'test-model',
    });

    controller.createAbortController(session.id);
    await controller.cancel(session.id);
    expect(controller.getStatus(session.id).status).toBe('cancelled');

    controller.cleanup(session.id);
    expect(controller.getStatus(session.id).status).toBe('idle');
  });

  it('skips cleanup for paused session and preserves pause state', async () => {
    const session = manager.createSession({
      title: 'paused-cleanup',
      provider: 'test',
      model: 'test-model',
    });

    controller.createAbortController(session.id);
    await controller.pause(session.id);
    controller.markAsPaused(session.id);
    expect(controller.getStatus(session.id).status).toBe('paused');

    controller.cleanup(session.id);
    expect(controller.getStatus(session.id).status).toBe('paused');
  });
});

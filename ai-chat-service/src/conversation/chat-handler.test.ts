import { describe, expect, it, vi } from 'vitest';
import type { ResolvedConfig } from '../config/schema.js';
import type { HarnessRuntime, HarnessSessionHandle } from '../harness/index.js';
import type { HarnessProjectionStore } from '../harness/projection-store.js';
import type { ChatSessionController } from '../services/chat-session-controller.js';
import { ChatHandler } from './chat-handler.js';
import type { ConversationManager } from './manager.js';
import type { SessionEventHub } from './session-event-hub.js';
import type { SessionEventsDAO } from './session-events-dao.js';

vi.mock('../services/logger.js', () => ({
  createWorkerLogger: () => ({ debug: vi.fn(), error: vi.fn() }),
}));

describe('ChatHandler', () => {
  it('flushes and projects a new turn before applying a durable pause checkpoint', async () => {
    const fixture = createFixture();
    fixture.harness.revision.mockResolvedValueOnce(undefined).mockResolvedValue('revision-1');
    fixture.controller.shouldPause.mockReturnValue(true);

    await fixture.handler.handleChatSend('test', {
      sessionId: 'session-1',
      message: '  hello  ',
      messageId: 'message-1',
    });

    expect(fixture.harness.openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        route: { provider: 'test', model: 'decision', temperature: 0, maxTokens: 100 },
        resume: false,
        signal: expect.any(AbortSignal),
        setup: expect.any(Function),
      })
    );
    expect(fixture.handle.followup).toHaveBeenCalledWith('hello', 'message-1');
    expect(fixture.handle.flush).toHaveBeenCalledBefore(fixture.projection.catchUp);
    expect(fixture.projection.catchUp).toHaveBeenCalledWith(
      'session-1',
      1,
      fixture.durableEvents,
      'revision-1'
    );
    expect(fixture.eventHub.publish).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ type: 'assistant.completed', sessionId: 'session-1' })
    );
    expect(fixture.controller.markAsPaused).toHaveBeenCalledWith('session-1');
    expect(fixture.handle.dispose).toHaveBeenCalledOnce();
    expect(fixture.controller.cleanup).toHaveBeenCalledWith('session-1');

    const setup = fixture.harness.openSession.mock.calls[0]?.[0].setup;
    const restrict = vi.fn();
    setup?.({
      tools: {
        schemas: () => [
          { name: 'gateway__browser_control__operation_execute' },
          { name: 'vision.analyze_page' },
        ],
        restrict,
      },
    } as never);
    expect(restrict).toHaveBeenCalledWith({
      deny: ['gateway__browser_control__operation_execute'],
    });
  });

  it('resumes only from an existing durable revision and propagates abort to the live DSH turn', async () => {
    const abortController = new AbortController();
    let settleFollowup = (): void => {};
    const fixture = createFixture({
      abortController,
      followup: () =>
        new Promise<void>((resolve) => {
          settleFollowup = resolve;
        }),
    });
    fixture.harness.revision.mockResolvedValue('revision-1');
    fixture.handle.cancel.mockImplementation(() => settleFollowup());

    const run = fixture.handler.resumeSession('test', 'session-1');
    await vi.waitFor(() => expect(fixture.handle.followup).toHaveBeenCalledOnce());
    abortController.abort('interrupted');
    await run;

    expect(fixture.harness.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ resume: true, signal: abortController.signal })
    );
    expect(fixture.handle.followup).toHaveBeenCalledWith(
      '请从上次已持久化的安全边界继续。',
      expect.any(String)
    );
    expect(fixture.handle.cancel).toHaveBeenCalledWith('user');
    expect(fixture.controller.markAsPaused).not.toHaveBeenCalled();

    fixture.harness.revision.mockResolvedValue(undefined);
    await expect(fixture.handler.resumeSession('test', 'session-1')).rejects.toThrow(
      'durable Harness log not found'
    );
  });

  it('rejects invalid or deleted sessions before opening Harness state', async () => {
    const fixture = createFixture();
    await expect(
      fixture.handler.handleChatSend('test', {
        sessionId: 'session-1',
        message: 'hello',
        screenshot: 'raw-bytes',
      })
    ).rejects.toThrow('Raw chat screenshots are not accepted');
    await expect(
      fixture.handler.handleChatSend('test', { sessionId: 'session-1', message: '   ' })
    ).rejects.toThrow('Message content is required');

    fixture.manager.getSession.mockReturnValue(null);
    await expect(
      fixture.handler.handleChatSend('test', { sessionId: 'missing', message: 'hello' })
    ).rejects.toThrow('Session missing not found');

    fixture.manager.getSession.mockReturnValue(session());
    fixture.projection.state.mockReturnValue({
      projectedDshSeq: 0,
      durableDshSeq: 0,
      deleted: true,
    });
    await expect(
      fixture.handler.handleChatSend('test', { sessionId: 'session-1', message: 'hello' })
    ).rejects.toThrow('is being deleted');
    expect(fixture.harness.openSession).not.toHaveBeenCalled();
  });

  it('recovers and catches up only durable non-deleted projections', async () => {
    const fixture = createFixture();
    fixture.manager.listSessions.mockReturnValue([
      session('deleted'),
      session('empty'),
      session('durable'),
    ]);
    fixture.projection.state.mockImplementation((sessionId: string) => ({
      projectedDshSeq: sessionId === 'durable' ? 2 : 0,
      durableDshSeq: 0,
      deleted: sessionId === 'deleted',
    }));
    fixture.harness.revision.mockImplementation(async (sessionId) =>
      String(sessionId) === 'empty' ? undefined : 'revision-2'
    );
    fixture.harness.readDurable.mockResolvedValue({
      durableSeq: 3,
      events: fixture.durableEvents,
    });

    await expect(fixture.handler.recoverDurableProjections()).resolves.toBe(1);
    expect(fixture.harness.readDurable).toHaveBeenCalledOnce();
    expect(fixture.harness.readDurable).toHaveBeenCalledWith('durable', 2);

    fixture.harness.revision.mockResolvedValueOnce(undefined).mockResolvedValue('revision-3');
    await expect(fixture.handler.catchUpDurable('empty')).resolves.toBeUndefined();
    await expect(
      fixture.handler.catchUpDurable('durable', { allowDeleted: true, publish: false })
    ).resolves.toBe('revision-3');
    expect(fixture.projection.catchUp).toHaveBeenLastCalledWith(
      'durable',
      3,
      fixture.durableEvents,
      'revision-3',
      { allowDeleted: true }
    );
  });

  it('drains active work and still cleans up when projection fails', async () => {
    let rejectFollowup = (_error: Error): void => {};
    const fixture = createFixture({
      followup: () =>
        new Promise<void>((_resolve, reject) => {
          rejectFollowup = reject;
        }),
    });
    fixture.harness.revision.mockResolvedValue('revision-1');
    fixture.handle.cancel.mockImplementation(() => rejectFollowup(new Error('cancelled')));
    fixture.handle.flush.mockRejectedValue(new Error('projection unavailable'));
    fixture.controller.cancel.mockRejectedValue(new Error('already settled'));

    const run = fixture.handler.handleChatSend('test', {
      sessionId: 'session-1',
      message: 'hello',
    });
    await vi.waitFor(() => expect(fixture.handle.followup).toHaveBeenCalledOnce());
    await fixture.handler.cancelAndDrain('session-1');
    await expect(run).rejects.toThrow('cancelled');
    expect(fixture.handle.cancel).toHaveBeenCalledWith('user');
    expect(fixture.controller.cancel).toHaveBeenCalledWith('session-1');
    expect(fixture.controller.cleanup).toHaveBeenCalledWith('session-1');
    await expect(fixture.handler.cancelAndDrain('missing')).resolves.toBeUndefined();
    await expect(fixture.handler.close()).resolves.toBeUndefined();
  });
});

function createFixture(options: {
  abortController?: AbortController;
  followup?: () => Promise<void>;
} = {}) {
  const durableEvents = [{ seq: 0, type: 'user/message', time: 1, data: {} }] as never[];
  const handle = {
    followup: vi.fn(options.followup ?? (async () => {})),
    cancel: vi.fn(),
    flush: vi.fn(async () => 1),
    dispose: vi.fn(async () => {}),
  } as unknown as HarnessSessionHandle;
  const harness = {
    revision: vi.fn(),
    openSession: vi.fn(async () => handle),
    readDurable: vi.fn(async () => ({ durableSeq: 1, events: durableEvents })),
  } as unknown as HarnessRuntime & {
    revision: ReturnType<typeof vi.fn>;
    openSession: ReturnType<typeof vi.fn>;
    readDurable: ReturnType<typeof vi.fn>;
  };
  const manager = {
    getSession: vi.fn(() => session()),
    listSessions: vi.fn(() => [session()]),
  } as unknown as ConversationManager & {
    getSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
  };
  const projection = {
    state: vi.fn(() => ({ projectedDshSeq: 0, durableDshSeq: 0, deleted: false })),
    catchUp: vi.fn(() => ({
      projectedDshSeq: 1,
      durableDshSeq: 1,
      publicEvents: [{ type: 'assistant.completed', sessionId: 'session-1' }],
    })),
  } as unknown as HarnessProjectionStore & {
    state: ReturnType<typeof vi.fn>;
    catchUp: ReturnType<typeof vi.fn>;
  };
  const eventHub = { publish: vi.fn() } as unknown as SessionEventHub & {
    publish: ReturnType<typeof vi.fn>;
  };
  const controller = {
    createAbortController: vi.fn(() => options.abortController ?? new AbortController()),
    cleanup: vi.fn(),
    shouldPause: vi.fn(() => false),
    markAsPaused: vi.fn(),
    cancel: vi.fn(async () => {}),
  } as unknown as ChatSessionController & {
    createAbortController: ReturnType<typeof vi.fn>;
    cleanup: ReturnType<typeof vi.fn>;
    shouldPause: ReturnType<typeof vi.fn>;
    markAsPaused: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  const config = {
    settings: { temperature: 0, maxTokens: 100 },
  } as ResolvedConfig;
  const handler = new ChatHandler(
    manager,
    config,
    harness,
    projection,
    {} as SessionEventsDAO,
    eventHub,
    controller
  );
  return { handler, handle, harness, manager, projection, eventHub, controller, durableEvents };
}

function session(id = 'session-1') {
  return {
    id,
    title: id,
    provider: 'test',
    model: 'decision',
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    summary: null,
    message_count: 0,
  };
}

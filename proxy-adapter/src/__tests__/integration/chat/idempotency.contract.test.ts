import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../../../conversation/manager.js';
import { ConversationJobQueue } from '../../../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../../../services/stream-persist-worker.js';

type ContractResult = {
  status: 202 | 208;
  idempotencyKey: string;
  messageId: string;
  jobId?: string;
};

describe('chat idempotency contract (service integration)', () => {
  let manager: ConversationManager;
  let queue: ConversationJobQueue;
  let persistWorker: StreamPersistWorker;
  let idempotencyResultMap: Map<string, ContractResult>;

  const submitMessage = async (
    sessionId: string,
    content: string,
    options?: { idempotencyKey?: string; headers?: Record<string, string> }
  ): Promise<ContractResult> => {
    const headerKey = options?.headers?.['x-idempotency-key'];
    const idempotencyKey = options?.idempotencyKey ?? headerKey ?? randomUUID();

    const existing = manager.getMessageByIdempotencyKey(idempotencyKey);
    if (existing && existing.session_id === sessionId) {
      const original = idempotencyResultMap.get(idempotencyKey);
      if (original) {
        return {
          ...original,
          status: 208,
        };
      }

      return {
        status: 208,
        idempotencyKey,
        messageId: existing.id,
      };
    }

    const message = manager.addMessage(sessionId, {
      role: 'user',
      content,
      idempotencyKey,
    });

    const jobId = await queue.enqueue({
      sessionId,
      execute: async () => {},
    });

    const result: ContractResult = {
      status: 202,
      idempotencyKey,
      messageId: message.id,
      jobId,
    };
    idempotencyResultMap.set(idempotencyKey, result);
    return result;
  };

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
    persistWorker = new StreamPersistWorker();
    queue = new ConversationJobQueue(persistWorker);
    idempotencyResultMap = new Map();
  });

  afterEach(async () => {
    await persistWorker.shutdown();
    await manager.close();
  });

  it('returns original result for same idempotency key on the same session (208 equivalent)', async () => {
    const session = manager.createSession({
      title: 'idempotent-same-key',
      provider: 'test',
      model: 'test-model',
    });

    const key = 'idem-same-session-key';
    const first = await submitMessage(session.id, 'hello', { idempotencyKey: key });
    const second = await submitMessage(session.id, 'hello again', { idempotencyKey: key });

    expect(first.status).toBe(202);
    expect(second.status).toBe(208);
    expect(second.messageId).toBe(first.messageId);
    expect(second.jobId).toBe(first.jobId);
    expect(manager.getMessages(session.id)).toHaveLength(1);
  });

  it('creates separate runs for different idempotency keys', async () => {
    const session = manager.createSession({
      title: 'idempotent-different-keys',
      provider: 'test',
      model: 'test-model',
    });

    const first = await submitMessage(session.id, 'first', { idempotencyKey: 'idem-1' });
    const second = await submitMessage(session.id, 'second', { idempotencyKey: 'idem-2' });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.jobId).not.toBe(first.jobId);
    expect(manager.getMessages(session.id)).toHaveLength(2);
  });

  it('accepts idempotency key from x-idempotency-key header', async () => {
    const session = manager.createSession({
      title: 'idempotent-header',
      provider: 'test',
      model: 'test-model',
    });

    const result = await submitMessage(session.id, 'header-key-message', {
      headers: {
        'x-idempotency-key': 'header-idem-key',
      },
    });

    const stored = manager.getMessageByIdempotencyKey('header-idem-key');
    expect(result.status).toBe(202);
    expect(result.idempotencyKey).toBe('header-idem-key');
    expect(stored?.id).toBe(result.messageId);
  });

  it('auto-generates UUID idempotency key when header and body key are absent', async () => {
    const session = manager.createSession({
      title: 'idempotent-auto-generated',
      provider: 'test',
      model: 'test-model',
    });

    const result = await submitMessage(session.id, 'auto-key-message');

    expect(result.status).toBe(202);
    expect(result.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(manager.getMessageByIdempotencyKey(result.idempotencyKey)?.id).toBe(result.messageId);
  });
});

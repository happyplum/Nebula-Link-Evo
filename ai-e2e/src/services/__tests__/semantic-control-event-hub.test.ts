import { describe, expect, it, vi } from 'vitest';
import { SemanticControlEventHub } from '../semantic-control-event-hub.js';

describe('SemanticControlEventHub', () => {
  it('isolates authoring/run contexts and removes unsubscribed listeners', () => {
    const hub = new SemanticControlEventHub();
    const authoringListener = vi.fn();
    const otherAuthoringListener = vi.fn();
    const runListener = vi.fn();
    const unsubscribe = hub.subscribe('authoring', 'job-1', authoringListener);
    hub.subscribe('authoring', 'job-2', otherAuthoringListener);
    hub.subscribe('run', 'job-1', runListener);
    const event = {
      id: 'event-1',
      seq: 1,
      schemaVersion: 1 as const,
      type: 'authoring.created',
      entityType: 'authoring_job',
      entityId: 'job-1',
      payload: {},
      occurredAt: '2026-10-05T00:00:00.000Z',
    };

    hub.publishControlEvent('authoring', 'job-1', event);
    hub.publishAuthoringMessage('job-1', {
      seq: 1,
      id: 'message-1',
      role: 'user',
      content: 'Repair this flow',
      created_at: '2026-10-05T00:00:01.000Z',
    });
    unsubscribe();
    hub.publishControlEvent('authoring', 'job-1', { ...event, seq: 2, id: 'event-2' });

    expect(authoringListener).toHaveBeenCalledTimes(2);
    expect(authoringListener).toHaveBeenNthCalledWith(1, { kind: 'control', event });
    expect(authoringListener).toHaveBeenNthCalledWith(2, {
      kind: 'authoring-message',
      message: {
        seq: 1,
        id: 'message-1',
        role: 'user',
        content: 'Repair this flow',
        created_at: '2026-10-05T00:00:01.000Z',
      },
    });
    expect(otherAuthoringListener).not.toHaveBeenCalled();
    expect(runListener).not.toHaveBeenCalled();
  });
});

import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type { SessionEventsDAO } from './session-events-dao.js';

type EventDraft = AgentStreamEventV1 extends infer Event
  ? Event extends AgentStreamEventV1
    ? Omit<Event, 'schema' | 'streamId' | 'seq'>
    : never
  : never;
export type SSESubscriber = (event: AgentStreamEventV1) => void;

/** Live fan-out for events that have already committed to the session event log. */
export class SessionEventHub {
  private static instance: SessionEventHub | null = null;
  private readonly subscribers = new Map<string, Map<string, SSESubscriber>>();
  private persistence?: SessionEventsDAO;

  static getInstance(): SessionEventHub {
    if (!SessionEventHub.instance) SessionEventHub.instance = new SessionEventHub();
    return SessionEventHub.instance;
  }

  static resetInstance(): void {
    SessionEventHub.instance = null;
  }

  bindPersistence(persistence: SessionEventsDAO): void {
    this.persistence = persistence;
  }

  subscribe(sessionId: string, callback: SSESubscriber): () => void {
    const subscriberId = crypto.randomUUID();
    const sessionSubscribers = this.subscribers.get(sessionId) ?? new Map<string, SSESubscriber>();
    sessionSubscribers.set(subscriberId, callback);
    this.subscribers.set(sessionId, sessionSubscribers);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const subscribers = this.subscribers.get(sessionId);
      subscribers?.delete(subscriberId);
      if (subscribers?.size === 0) this.subscribers.delete(sessionId);
    };
  }

  publish(sessionId: string, event: AgentStreamEventV1): void {
    const sessionSubscribers = this.subscribers.get(sessionId);
    if (!sessionSubscribers) return;
    for (const callback of sessionSubscribers.values()) {
      try {
        callback(event);
      } catch {
        // A broken consumer must not prevent delivery to other subscribers.
      }
    }
  }

  persistAndPublish(sessionId: string, draft: EventDraft): AgentStreamEventV1 {
    if (!this.persistence) throw new Error('Session event persistence is not initialized');
    const seq = this.persistence.appendEventSync(sessionId, 'agent_stream.event', draft);
    const event = {
      schema: AGENT_STREAM_EVENT_SCHEMA,
      streamId: sessionId,
      seq,
      ...draft,
    } as AgentStreamEventV1;
    this.publish(sessionId, event);
    return event;
  }

  getSubscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }

  close(): void {
    this.subscribers.clear();
  }

  emitJobQueued(
    sessionId: string,
    job: { jobId: string; messageId: string; contentPreview: string; createdAt: number }
  ): void {
    const occurredAt = new Date(job.createdAt).toISOString();
    this.persistActivity(sessionId, job.jobId, 'queued', '消息已进入执行队列', occurredAt);
  }

  emitJobStarted(sessionId: string, jobId: string): void {
    this.persistActivity(sessionId, jobId, 'running', '消息开始执行', new Date().toISOString());
  }

  emitJobCancelled(sessionId: string, jobId: string): void {
    this.persistActivity(sessionId, jobId, 'cancelled', '排队任务已取消', new Date().toISOString());
  }

  emitJobCompleted(sessionId: string, jobId: string): void {
    this.persistActivity(sessionId, jobId, 'completed', '消息执行完成', new Date().toISOString());
  }

  private persistActivity(
    sessionId: string,
    jobId: string,
    state: 'queued' | 'running' | 'completed' | 'cancelled',
    summary: string,
    occurredAt: string
  ): void {
    const turnId = `job:${jobId}`;
    this.persistAndPublish(sessionId, {
      type: 'section.upsert',
      turnId,
      sectionId: `job:${jobId}`,
      occurredAt,
      section: {
        type: 'activity',
        sectionId: `job:${jobId}`,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        kind: 'agent',
        state,
        title: '会话任务',
        summary,
      },
    });
  }
}

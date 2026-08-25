/**
 * SessionEventHub - Pub/Sub event hub for SSE streaming
 *
 * Singleton pattern for managing SSE connections per session.
 * NO event caching - only forwards to active subscribers.
 */

import type { SessionEvent } from '@nebula-link-evo/shared';

export type { SessionEvent } from '@nebula-link-evo/shared';

export type SSESubscriber = (event: SessionEvent) => void;

export class SessionEventHub {
  private static instance: SessionEventHub | null = null;

  /**
   * Map<sessionId, Map<subscriberId, callback>>
   * Uses subscriber ID to support multiple subscribers per session
   */
  private subscribers = new Map<string, Map<string, SSESubscriber>>();

  constructor() {}

  static getInstance(): SessionEventHub {
    if (!SessionEventHub.instance) {
      SessionEventHub.instance = new SessionEventHub();
    }
    return SessionEventHub.instance;
  }

  /**
   * Reset singleton instance - for testing only
   */
  static resetInstance(): void {
    SessionEventHub.instance = null;
  }

  /**
   * Subscribe to events for a session
   * @returns Unsubscribe function
   */
  subscribe(sessionId: string, callback: SSESubscriber): () => void {
    const subscriberId = crypto.randomUUID();

    let sessionSubscribers = this.subscribers.get(sessionId);
    if (!sessionSubscribers) {
      sessionSubscribers = new Map();
      this.subscribers.set(sessionId, sessionSubscribers);
    }
    sessionSubscribers.set(subscriberId, callback);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;

      const subs = this.subscribers.get(sessionId);
      if (!subs) return;

      subs.delete(subscriberId);
      if (subs.size === 0) {
        this.subscribers.delete(sessionId);
      }
    };
  }

  /**
   * Publish event to all subscribers of a session
   * NO caching - only forwards to active subscribers
   */
  publish(sessionId: string, event: SessionEvent): void {
    const sessionSubscribers = this.subscribers.get(sessionId);
    if (!sessionSubscribers || sessionSubscribers.size === 0) return;

    for (const callback of sessionSubscribers.values()) {
      try {
        callback(event);
      } catch {
        // Continue delivering to other subscribers
      }
    }
  }

  /**
   * Get subscriber count for a session
   */
  getSubscriberCount(sessionId: string): number {
    const sessionSubscribers = this.subscribers.get(sessionId);
    return sessionSubscribers?.size ?? 0;
  }

  close(): void {
    this.subscribers.clear();
  }

  /**
   * Emit job.queued event for a session
   */
  emitJobQueued(
    sessionId: string,
    job: { jobId: string; messageId: string; contentPreview: string; createdAt: number }
  ): void {
    this.publish(sessionId, {
      type: 'job.queued',
      sessionId,
      job: {
        jobId: job.jobId,
        sessionId,
        messageId: job.messageId,
        contentPreview: job.contentPreview,
        createdAt: new Date(job.createdAt).toISOString(),
        status: 'queued',
      },
    });
  }

  /**
   * Emit job.started event for a session
   */
  emitJobStarted(sessionId: string, jobId: string): void {
    this.publish(sessionId, { type: 'job.started', sessionId, jobId });
  }

  /**
   * Emit job.cancelled event for a session
   */
  emitJobCancelled(sessionId: string, jobId: string): void {
    this.publish(sessionId, { type: 'job.cancelled', sessionId, jobId });
  }

  /**
   * Emit job.completed event for a session
   */
  emitJobCompleted(sessionId: string, jobId: string): void {
    this.publish(sessionId, { type: 'job.completed', sessionId, jobId });
  }
}

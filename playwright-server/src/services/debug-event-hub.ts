import { randomUUID } from 'node:crypto';
import type {
  DebugPlaywrightState,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugStreamEvent,
} from '@nebula-link-evo/shared';

export type DebugEventSubscriber = (event: DebugStreamEvent) => void;

function isStatusEvent(event: DebugStreamEvent): event is DebugSnapshotEvent | DebugStatusEvent {
  return event.type === 'debug.snapshot' || event.type === 'debug.status';
}

export class DebugEventHub {
  private static instance: DebugEventHub | null = null;

  private subscribers = new Map<string, DebugEventSubscriber>();
  private latestStatus: DebugPlaywrightState | null = null;
  private nextSeqValue = 1;

  private constructor() {}

  static getInstance(): DebugEventHub {
    if (!DebugEventHub.instance) {
      DebugEventHub.instance = new DebugEventHub();
    }

    return DebugEventHub.instance;
  }

  static resetInstance(): void {
    DebugEventHub.instance = null;
  }

  subscribe(callback: DebugEventSubscriber): () => void {
    const subscriberId = randomUUID();
    this.subscribers.set(subscriberId, callback);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }

      unsubscribed = true;
      this.subscribers.delete(subscriberId);
    };
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getLatestStatus(): DebugPlaywrightState | null {
    return this.latestStatus;
  }

  getNextSeq(): number {
    const seq = this.nextSeqValue;
    this.nextSeqValue += 1;
    return seq;
  }

  publish(event: DebugStreamEvent): void {
    const sequencedEvent: DebugStreamEvent = {
      ...event,
      seq: event.seq ?? this.getNextSeq(),
    };

    if (isStatusEvent(sequencedEvent)) {
      this.latestStatus = sequencedEvent.status;
    }

    for (const callback of this.subscribers.values()) {
      try {
        callback(sequencedEvent);
      } catch {
        // Continue delivering to remaining subscribers.
      }
    }
  }

  publishStatus(status: DebugPlaywrightState): void {
    this.publish({
      type: 'debug.status',
      status,
      emittedAt: new Date().toISOString(),
    });
  }

  resetForTests(): void {
    this.subscribers.clear();
    this.latestStatus = null;
    this.nextSeqValue = 1;
  }
}

export const debugEventHub = DebugEventHub.getInstance();

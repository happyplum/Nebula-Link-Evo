import type {
  DebugPlaywrightState,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugStreamEvent,
} from '@nebula-link-evo/shared/types/debug-events.js';

export type DebugEventSubscriber = (event: DebugStreamEvent) => void;

function isStatusEvent(event: DebugStreamEvent): event is DebugSnapshotEvent | DebugStatusEvent {
  return event.type === 'debug.snapshot' || event.type === 'debug.status';
}

export class DebugEventHub {
  private subscribers = new Map<string, DebugEventSubscriber>();
  private latestStatus: DebugPlaywrightState | null = null;
  private nextSeq = 1;

  publish(event: DebugStreamEvent): void {
    const sequencedEvent = {
      ...event,
      seq: event.seq ?? this.getNextSeq(),
    } as DebugStreamEvent;

    if (isStatusEvent(sequencedEvent)) {
      this.latestStatus = sequencedEvent.status;
    }

    for (const callback of this.subscribers.values()) {
      try {
        callback(sequencedEvent);
      } catch {
        // Continue delivering even if one subscriber throws.
      }
    }
  }

  subscribe(callback: DebugEventSubscriber): () => void {
    const subscriberId = crypto.randomUUID();
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

  getLatestStatus(): DebugPlaywrightState | null {
    return this.latestStatus;
  }

  getNextSeq(): number {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    return seq;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  resetForTests(): void {
    this.subscribers.clear();
    this.latestStatus = null;
    this.nextSeq = 1;
  }
}

export const debugEventHub = new DebugEventHub();

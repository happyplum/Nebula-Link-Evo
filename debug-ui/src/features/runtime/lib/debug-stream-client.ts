import type {
  DebugErrorEvent,
  DebugKeepaliveEvent,
  DebugMcpInvalidatedEvent,
  DebugSnapshotEvent,
  DebugStatusEvent,
} from '@nebula-link-evo/shared/types/debug-events';

export const DEBUG_STREAM_PATH = '/debug/api/stream';

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const RECONNECT_JITTER_RATIO = 0.25;

export type DebugStreamConnectionState = 'connecting' | 'connected' | 'disconnected';

type DebugStreamEventMap = {
  'debug.snapshot': DebugSnapshotEvent;
  'debug.status': DebugStatusEvent;
  'debug.mcp_invalidated': DebugMcpInvalidatedEvent;
  'debug.error': DebugErrorEvent;
  'debug.keepalive': DebugKeepaliveEvent;
};

type DebugStreamEventType = keyof DebugStreamEventMap;
type EventSubscriber<TEvent extends DebugStreamEventType> = (
  event: MessageEvent<string>,
) => void | Promise<void>;
type SubscriberSet = Set<(event: MessageEvent<string>) => void | Promise<void>>;
type ConnectionStateSubscriber = (state: DebugStreamConnectionState) => void;

let eventSource: EventSource | null = null;
let refCount = 0;
let connectionState: DebugStreamConnectionState = 'disconnected';
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const subscribersByEventType = new Map<DebugStreamEventType, SubscriberSet>();
const connectionStateSubscribers = new Set<ConnectionStateSubscriber>();

function setConnectionState(state: DebugStreamConnectionState): void {
  connectionState = state;
  for (const subscriber of connectionStateSubscribers) {
    subscriber(state);
  }
}

function notifySubscribers(type: DebugStreamEventType, event: MessageEvent<string>): void {
  const subscribers = subscribersByEventType.get(type);
  if (!subscribers) return;

  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // Keep the singleton bridge alive even if a consumer fails.
    }
  }
}

function cleanupEventSource(): void {
  if (!eventSource) return;
  eventSource.close();
  eventSource = null;
}

function clearReconnectTimer(): void {
  if (reconnectTimer === null) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function resetReconnectState(): void {
  reconnectAttempt = 0;
  clearReconnectTimer();
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || refCount <= 0) {
    if (refCount <= 0) {
      setConnectionState('disconnected');
    }
    return;
  }

  const baseDelay = Math.min(
    INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
    MAX_RECONNECT_DELAY_MS,
  );
  const delay = Math.min(
    Math.round(baseDelay + baseDelay * RECONNECT_JITTER_RATIO * Math.random()),
    MAX_RECONNECT_DELAY_MS,
  );

  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect(): void {
  if (eventSource || refCount <= 0) return;
  if (typeof EventSource === 'undefined') {
    setConnectionState('disconnected');
    return;
  }

  setConnectionState('connecting');

  const es = new EventSource(DEBUG_STREAM_PATH);

  es.onopen = () => {
    setConnectionState('connected');
    resetReconnectState();
  };

  es.addEventListener('debug.snapshot', (event) => {
    notifySubscribers('debug.snapshot', event as MessageEvent<string>);
  });

  es.addEventListener('debug.status', (event) => {
    notifySubscribers('debug.status', event as MessageEvent<string>);
  });

  es.addEventListener('debug.mcp_invalidated', (event) => {
    notifySubscribers('debug.mcp_invalidated', event as MessageEvent<string>);
  });

  es.addEventListener('debug.error', (event) => {
    notifySubscribers('debug.error', event as MessageEvent<string>);
  });

  es.addEventListener('debug.keepalive', (event) => {
    notifySubscribers('debug.keepalive', event as MessageEvent<string>);
  });

  es.onerror = () => {
    cleanupEventSource();
    setConnectionState('disconnected');
    scheduleReconnect();
  };

  eventSource = es;
}

export const debugStreamClient = {
  acquire(): void {
    refCount += 1;
    if (refCount === 1) {
      connect();
    }
  },

  release(): void {
    refCount -= 1;
    if (refCount > 0) return;

    refCount = 0;
    cleanupEventSource();
    resetReconnectState();
    setConnectionState('disconnected');
  },

  subscribe<TEvent extends DebugStreamEventType>(
    type: TEvent,
    handler: EventSubscriber<TEvent>,
  ): () => void {
    if (!subscribersByEventType.has(type)) {
      subscribersByEventType.set(type, new Set());
    }

    const subscribers = subscribersByEventType.get(type)!;
    subscribers.add(handler as (event: MessageEvent<string>) => void | Promise<void>);

    return () => {
      const nextSubscribers = subscribersByEventType.get(type);
      nextSubscribers?.delete(handler as (event: MessageEvent<string>) => void | Promise<void>);
      if (nextSubscribers?.size === 0) {
        subscribersByEventType.delete(type);
      }
    };
  },

  subscribeConnectionState(listener: ConnectionStateSubscriber): () => void {
    connectionStateSubscribers.add(listener);
    return () => {
      connectionStateSubscribers.delete(listener);
    };
  },

  getConnectionState(): DebugStreamConnectionState {
    return connectionState;
  },

  forceReconnect(): void {
    cleanupEventSource();
    clearReconnectTimer();
    reconnectAttempt = 0;
    setConnectionState(refCount > 0 ? 'connecting' : 'disconnected');
    if (refCount > 0) {
      connect();
    }
  },

  _reset(): void {
    cleanupEventSource();
    clearReconnectTimer();
    reconnectAttempt = 0;
    refCount = 0;
    subscribersByEventType.clear();
    connectionStateSubscribers.clear();
    setConnectionState('disconnected');
  },
};

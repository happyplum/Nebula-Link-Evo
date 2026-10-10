import { useEffect, useSyncExternalStore } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import type {
  DebugErrorEvent,
  DebugKeepaliveEvent,
  DebugMcpInvalidatedEvent,
  DebugSnapshotEvent,
  DebugStatusEvent,
} from '@nebula-link-evo/shared/types/debug-events';

import { applyPlaywrightStatus } from '@/features/runtime/lib/apply-playwright-status.js';
import { debugStreamClient } from '@/features/runtime/lib/debug-stream-client.js';
import { queryKeys } from '@/shared/query/query-keys.js';

export interface DebugStreamHealth {
  connectionState: ReturnType<typeof debugStreamClient.getConnectionState>;
  lastErrorAt: number;
  lastKeepaliveAt: number;
  lastMessageAt: number;
}

let streamHealth: DebugStreamHealth = {
  connectionState: debugStreamClient.getConnectionState(),
  lastErrorAt: 0,
  lastKeepaliveAt: 0,
  lastMessageAt: 0,
};

const healthSubscribers = new Set<() => void>();

function notifyHealthSubscribers(): void {
  for (const subscriber of healthSubscribers) {
    subscriber();
  }
}

function setStreamHealth(next: Partial<DebugStreamHealth>): void {
  streamHealth = {
    ...streamHealth,
    ...next,
  };
  notifyHealthSubscribers();
}

function subscribeToStreamHealth(subscriber: () => void): () => void {
  healthSubscribers.add(subscriber);
  return () => {
    healthSubscribers.delete(subscriber);
  };
}

function getStreamHealthSnapshot(): DebugStreamHealth {
  return streamHealth;
}

function parseEventData<TEvent>(event: MessageEvent<string>): TEvent {
  return JSON.parse(event.data) as TEvent;
}

export function useDebugStream(): DebugStreamHealth {
  const queryClient = useQueryClient();
  const health = useSyncExternalStore(
    subscribeToStreamHealth,
    getStreamHealthSnapshot,
    getStreamHealthSnapshot
  );

  useEffect(() => {
    debugStreamClient.acquire();
    setStreamHealth({ connectionState: debugStreamClient.getConnectionState() });

    const unsubscribeConnectionState = debugStreamClient.subscribeConnectionState(
      (connectionState) => {
        setStreamHealth({
          connectionState,
          lastMessageAt: connectionState === 'connected' ? Date.now() : streamHealth.lastMessageAt,
        });
      }
    );

    const unsubscribeSnapshot = debugStreamClient.subscribe('debug.snapshot', (event) => {
      const snapshot = parseEventData<DebugSnapshotEvent>(event);
      applyPlaywrightStatus(snapshot.status);
      setStreamHealth({ lastMessageAt: Date.now() });
    });

    const unsubscribeStatus = debugStreamClient.subscribe('debug.status', (event) => {
      const status = parseEventData<DebugStatusEvent>(event);
      applyPlaywrightStatus(status.status);
      setStreamHealth({ lastMessageAt: Date.now() });
    });

    const unsubscribeMcp = debugStreamClient.subscribe('debug.mcp_invalidated', async (event) => {
      parseEventData<DebugMcpInvalidatedEvent>(event);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.health }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tools }),
      ]);
    });

    const unsubscribeError = debugStreamClient.subscribe('debug.error', (event) => {
      const error = parseEventData<DebugErrorEvent>(event);
      console.warn('[debug-stream]', error.message);
      setStreamHealth({ lastErrorAt: Date.now() });
    });

    const unsubscribeKeepalive = debugStreamClient.subscribe('debug.keepalive', (event) => {
      parseEventData<DebugKeepaliveEvent>(event);
      const now = Date.now();
      setStreamHealth({
        lastKeepaliveAt: now,
        lastMessageAt: now,
      });
    });

    return () => {
      unsubscribeConnectionState();
      unsubscribeSnapshot();
      unsubscribeStatus();
      unsubscribeMcp();
      unsubscribeError();
      unsubscribeKeepalive();
      debugStreamClient.release();
    };
  }, [queryClient]);

  return health;
}

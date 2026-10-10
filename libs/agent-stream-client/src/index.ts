import { useMemo } from 'react';
import {
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';

import {
  useConnectionCore,
  type ConnectionStatus,
  type DecodedValue,
} from './connection-core.js';
import { createFetchSseTransport } from './sse-transport.js';

export type AgentStreamConnectionStatus = ConnectionStatus;

export interface AgentStreamConnectionOptions {
  endpoint: string;
  streamId: string;
  enabled?: boolean;
  onSnapshot: (snapshot: AgentStreamSnapshotV1) => void;
  onEvents: (events: AgentStreamEventV1[]) => void;
}

export interface AgentStreamConnection {
  status: AgentStreamConnectionStatus;
  reconnect: () => void;
  disconnect: () => void;
}

export interface SnapshotEventConnectionOptions<TSnapshot, TEvent = unknown> {
  readonly endpoint: string;
  readonly contextKey?: string;
  readonly enabled?: boolean;
  readonly snapshotEvent: string;
  readonly eventFilter?: (eventName: string) => boolean;
  readonly onSnapshot: (snapshot: TSnapshot) => void;
  readonly onEvent?: (eventName: string, data: TEvent) => void;
  readonly validateSnapshot?: (value: unknown) => value is TSnapshot;
}

export interface SnapshotEventConnection {
  readonly status: ConnectionStatus;
  readonly reconnect: () => void;
  readonly disconnect: () => void;
}

interface SnapshotEvent<TEvent> {
  readonly eventName: string;
  readonly data: TEvent;
}

const DEFAULT_EVENT_FILTER = (eventName: string) =>
  eventName !== 'heartbeat' && eventName !== 'comment';

/** Owns the Agent Stream transport while the host owns replay and business state. */
export function useAgentStreamConnection({
  endpoint,
  streamId,
  enabled = true,
  onSnapshot,
  onEvents,
}: AgentStreamConnectionOptions): AgentStreamConnection {
  const connectionKey = useMemo(
    () => ({ endpoint, streamId, enabled }),
    [endpoint, streamId, enabled]
  );
  return useConnectionCore({
    endpoint,
    connectionKey,
    enabled,
    available: enabled && Boolean(streamId) && typeof EventSource !== 'undefined',
    snapshotEvent: 'agent_stream.snapshot',
    eventNames: ['agent_stream.snapshot', 'agent_stream.event'],
    surfaceEventsBeforeSnapshot: false,
    batchEvents: true,
    decodeSnapshot: (value): DecodedValue<AgentStreamSnapshotV1> =>
      isAgentStreamSnapshot(value) && value.streamId === streamId
        ? { accepted: true, value }
        : { accepted: false },
    decodeEvent: (eventName, value): DecodedValue<AgentStreamEventV1> =>
      eventName === 'agent_stream.event' &&
      isAgentStreamEvent(value) &&
      value.streamId === streamId
        ? { accepted: true, value }
        : { accepted: false },
    onSnapshot,
    onEvents,
  });
}

/** Connects to generic named-event SSE protocols with snapshot-first status gating. */
export function useSnapshotEventConnection<TSnapshot, TEvent = unknown>(
  options: SnapshotEventConnectionOptions<TSnapshot, TEvent>
): SnapshotEventConnection {
  const {
    endpoint,
    contextKey = endpoint,
    enabled = true,
    snapshotEvent,
    eventFilter = DEFAULT_EVENT_FILTER,
    onSnapshot,
    onEvent,
    validateSnapshot,
  } = options;
  const connectionKey = useMemo(
    () => ({ endpoint, contextKey, enabled, snapshotEvent }),
    [endpoint, contextKey, enabled, snapshotEvent]
  );

  return useConnectionCore<TSnapshot, SnapshotEvent<TEvent>>({
    endpoint,
    connectionKey,
    enabled,
    available: enabled && typeof fetch !== 'undefined',
    snapshotEvent,
    eventNames: [],
    transportFactory: createFetchSseTransport,
    surfaceEventsBeforeSnapshot: true,
    batchEvents: false,
    decodeSnapshot: (value) => {
      if (!isRecord(value) || !Object.hasOwn(value, 'snapshot')) {
        return { accepted: false };
      }
      const snapshot = value.snapshot;
      if (validateSnapshot && !validateSnapshot(snapshot)) {
        return { accepted: false, retry: true };
      }
      return { accepted: true, value: snapshot as TSnapshot };
    },
    decodeEvent: (eventName, value) =>
      eventFilter(eventName)
        ? { accepted: true, value: { eventName, data: value as TEvent } }
        : { accepted: false },
    onSnapshot,
    onEvent: (event) => onEvent?.(event.eventName, event.data),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

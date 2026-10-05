import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createEventSourceTransport,
  type SseFrame,
  type SseTransport,
  type SseTransportFactory,
} from './sse-transport.js';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'live';

export interface ConnectionControls {
  readonly status: ConnectionStatus;
  readonly reconnect: () => void;
  readonly disconnect: () => void;
}

export type DecodedValue<T> =
  | { readonly accepted: false; readonly retry?: boolean }
  | { readonly accepted: true; readonly value: T };

export interface ConnectionCoreOptions<TSnapshot, TEvent> {
  readonly endpoint: string;
  readonly connectionKey: object;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly snapshotEvent: string;
  readonly eventNames: readonly string[];
  readonly transportFactory?: SseTransportFactory;
  readonly surfaceEventsBeforeSnapshot: boolean;
  readonly batchEvents: boolean;
  readonly decodeSnapshot: (value: unknown) => DecodedValue<TSnapshot>;
  readonly decodeEvent: (eventName: string, value: unknown) => DecodedValue<TEvent>;
  readonly onSnapshot: (snapshot: TSnapshot) => void;
  readonly onEvent?: (event: TEvent) => void;
  readonly onEvents?: (events: TEvent[]) => void;
}

interface ActiveConnection {
  readonly connectionKey: object;
  readonly status: ConnectionStatus;
}

type ParsedEventData =
  | { readonly accepted: false }
  | { readonly accepted: true; readonly value: unknown };

export function useConnectionCore<TSnapshot, TEvent>(
  options: ConnectionCoreOptions<TSnapshot, TEvent>
): ConnectionControls {
  const current = useRef(options);
  current.current = options;
  const controls = useRef<{ reconnect: () => void; disconnect: () => void } | null>(null);
  const [connection, setConnection] = useState<ActiveConnection | null>(null);

  useEffect(() => {
    if (!options.enabled || !options.available) return;

    let disposed = false;
    let generation = 0;
    let transport: SseTransport | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;
    let frameGeneration = 0;
    let pending: TEvent[] = [];
    let nextDelay = 1000;

    const isCurrent = () => !disposed && current.current.connectionKey === options.connectionKey;
    const setStatus = (status: ConnectionStatus) => {
      if (isCurrent()) setConnection({ connectionKey: options.connectionKey, status });
    };
    const clearBatch = () => {
      frameGeneration += 1;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending = [];
    };
    const stop = () => {
      generation += 1;
      clearBatch();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      transport?.close();
      transport = null;
    };
    const connect = (reconnecting: boolean) => {
      stop();
      if (!isCurrent()) return;
      setStatus(reconnecting ? 'reconnecting' : 'connecting');

      const activeGeneration = generation;
      let activeTransport: SseTransport | null = null;
      let hasSnapshot = false;
      const isActive = () =>
        isCurrent() && generation === activeGeneration && transport === activeTransport;
      const scheduleReconnect = () => {
        if (!isActive()) return;
        stop();
        setStatus('reconnecting');
        const retryGeneration = generation;
        const delay = nextDelay;
        nextDelay = Math.min(nextDelay * 2, 30_000);
        timer = setTimeout(() => {
          if (!isCurrent() || generation !== retryGeneration) return;
          timer = null;
          connect(true);
        }, delay);
      };
      const handleFrame = (receivedFrame: SseFrame) => {
        if (!isActive()) return;
        const parsed = parseEventData(receivedFrame.data);
        if (!parsed.accepted) return;

        if (receivedFrame.eventName === current.current.snapshotEvent) {
          const decoded = current.current.decodeSnapshot(parsed.value);
          if (!decoded.accepted) {
            if (decoded.retry) scheduleReconnect();
            return;
          }
          clearBatch();
          hasSnapshot = true;
          nextDelay = 1000;
          current.current.onSnapshot(decoded.value);
          setStatus('live');
          return;
        }

        if (!hasSnapshot && !current.current.surfaceEventsBeforeSnapshot) return;
        const decoded = current.current.decodeEvent(receivedFrame.eventName, parsed.value);
        if (!decoded.accepted) return;
        if (!current.current.batchEvents) {
          current.current.onEvent?.(decoded.value);
          return;
        }

        pending.push(decoded.value);
        if (frame !== null) return;
        const activeFrameGeneration = frameGeneration;
        frame = requestAnimationFrame(() => {
          if (!isActive() || frameGeneration !== activeFrameGeneration) return;
          frame = null;
          const events = pending;
          pending = [];
          current.current.onEvents?.(events);
        });
      };

      activeTransport = (current.current.transportFactory ?? createEventSourceTransport)({
        endpoint: options.endpoint,
        eventNames: current.current.eventNames,
        handlers: {
          onFrame: handleFrame,
          onError: () => {
            if (!isActive()) return;
            scheduleReconnect();
          },
        },
      });
      transport = activeTransport;
    };

    const activeControls = {
      reconnect: () => {
        if (!isCurrent()) return;
        connect(true);
      },
      disconnect: () => {
        stop();
        setStatus('disconnected');
      },
    };
    controls.current = activeControls;
    connect(false);
    return () => {
      disposed = true;
      stop();
      if (controls.current === activeControls) controls.current = null;
    };
  }, [options.available, options.connectionKey, options.enabled, options.endpoint]);

  const reconnect = useCallback(() => controls.current?.reconnect(), []);
  const disconnect = useCallback(() => controls.current?.disconnect(), []);
  const status = !options.enabled || !options.available
    ? 'disconnected'
    : connection?.connectionKey === options.connectionKey
      ? connection.status
      : 'connecting';

  return { status, reconnect, disconnect };
}

function parseEventData(data: string): ParsedEventData {
  try {
    return { accepted: true, value: JSON.parse(data) as unknown };
  } catch (error) {
    if (error instanceof SyntaxError) return { accepted: false };
    throw error;
  }
}

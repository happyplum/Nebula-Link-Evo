import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';

export type AgentStreamConnectionStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'live';

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

/** Owns transport resources only. The consumer owns snapshots, replay and business state. */
export function useAgentStreamConnection({
  endpoint,
  streamId,
  enabled = true,
  onSnapshot,
  onEvents,
}: AgentStreamConnectionOptions): AgentStreamConnection {
  const contextKey = useMemo(
    () => ({ endpoint, streamId, enabled }),
    [endpoint, streamId, enabled]
  );
  const current = useRef({ contextKey, onSnapshot, onEvents });
  current.current = { contextKey, onSnapshot, onEvents };
  const controls = useRef<{ reconnect: () => void; disconnect: () => void } | null>(null);
  const [connection, setConnection] = useState<{
    contextKey: typeof contextKey;
    status: AgentStreamConnectionStatus;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !streamId || typeof EventSource === 'undefined') return;
    let disposed = false;
    let generation = 0;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;
    let frameGeneration = 0;
    let pending: AgentStreamEventV1[] = [];
    let nextDelay = 1000;

    const isCurrent = () => !disposed && current.current.contextKey === contextKey;
    const setStatus = (status: AgentStreamConnectionStatus) => {
      if (isCurrent()) setConnection({ contextKey, status });
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
      source?.close();
      source = null;
    };
    const connect = (reconnecting: boolean) => {
      stop();
      if (!isCurrent()) return;
      setStatus(reconnecting ? 'reconnecting' : 'connecting');
      const activeGeneration = generation;
      const activeSource = new EventSource(endpoint);
      source = activeSource;
      let hasSnapshot = false;
      const isActive = () =>
        isCurrent() && generation === activeGeneration && source === activeSource;
      activeSource.addEventListener('agent_stream.snapshot', (raw: MessageEvent) => {
        if (!isActive()) return;
        const payload = parseEventData(raw.data);
        if (!isAgentStreamSnapshot(payload) || payload.streamId !== streamId) return;
        clearBatch();
        hasSnapshot = true;
        nextDelay = 1000;
        current.current.onSnapshot(payload);
        setStatus('live');
      });
      activeSource.addEventListener('agent_stream.event', (raw: MessageEvent) => {
        if (!isActive() || !hasSnapshot) return;
        const payload = parseEventData(raw.data);
        if (!isAgentStreamEvent(payload) || payload.streamId !== streamId) return;
        pending.push(payload);
        if (frame !== null) return;
        const activeFrameGeneration = frameGeneration;
        frame = requestAnimationFrame(() => {
          if (!isActive() || frameGeneration !== activeFrameGeneration) return;
          frame = null;
          const events = pending;
          pending = [];
          current.current.onEvents(events);
        });
      });
      // EventSource.onopen is not bootstrap evidence; only a matching snapshot becomes live.
      activeSource.onerror = () => {
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
  }, [contextKey, enabled, endpoint, streamId]);

  const reconnect = useCallback(() => controls.current?.reconnect(), []);
  const disconnect = useCallback(() => controls.current?.disconnect(), []);
  const available = enabled && Boolean(streamId) && typeof EventSource !== 'undefined';
  const status = !available
    ? 'disconnected'
    : connection?.contextKey === contextKey
      ? connection.status
      : 'connecting';
  return { status, reconnect, disconnect };
}

function parseEventData(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

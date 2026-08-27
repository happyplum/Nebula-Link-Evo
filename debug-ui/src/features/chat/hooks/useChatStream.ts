import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { useChatStore } from '@/features/chat/store/chat.store.js';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface UseChatStreamOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export interface UseChatStreamReturn {
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useChatStream({
  sessionId,
  enabled = true,
}: UseChatStreamOptions): UseChatStreamReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const pendingEventsRef = useRef<Array<{ sessionId: string; event: AgentStreamEventV1 }>>([]);
  const frameRef = useRef<number | null>(null);
  sessionIdRef.current = sessionId;

  const flush = useCallback(() => {
    frameRef.current = null;
    const events = pendingEventsRef.current;
    pendingEventsRef.current = [];
    const store = useChatStore.getState();
    for (const item of events) store.applyActivityEvent(item.sessionId, item.event);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const cleanup = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    flush();
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsConnected(false);
  }, [flush]);

  const connect = useCallback(
    (sid: string) => {
      cleanup();
      const source = new EventSource(`/api/v1/chat/sessions/${sid}/stream`);
      eventSourceRef.current = source;
      source.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;
      };
      source.addEventListener('agent_stream.snapshot', (raw: MessageEvent) => {
        const payload = parseEventData(raw.data);
        if (!isAgentStreamSnapshot(payload) || payload.streamId !== sid) return;
        useChatStore.getState().setActivitySnapshot(sid, payload);
      });
      source.addEventListener('agent_stream.event', (raw: MessageEvent) => {
        const payload = parseEventData(raw.data);
        if (!isAgentStreamEvent(payload) || payload.streamId !== sid) return;
        pendingEventsRef.current.push({ sessionId: sid, event: payload });
        scheduleFlush();
      });
      source.onerror = () => {
        setIsConnected(false);
        source.close();
        if (eventSourceRef.current === source) eventSourceRef.current = null;
        if (reconnectAttemptRef.current >= 5) {
          setError('活动流连接失败，请手动重试。');
          useChatStore.getState().setStreamingState('error');
          return;
        }
        const delay = Math.min(
          INITIAL_BACKOFF_MS * 2 ** reconnectAttemptRef.current,
          MAX_BACKOFF_MS
        );
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          const current = sessionIdRef.current;
          if (current) connect(current);
        }, delay);
      };
    },
    [cleanup, scheduleFlush]
  );

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    if (sessionId) connect(sessionId);
  }, [connect, sessionId]);
  const disconnect = useCallback(() => {
    cleanup();
    reconnectAttemptRef.current = 0;
    setError(null);
  }, [cleanup]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      cleanup();
      return;
    }
    connect(sessionId);
    return cleanup;
  }, [cleanup, connect, enabled, sessionId]);

  return { isConnected, error, reconnect, disconnect };
}

function parseEventData(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

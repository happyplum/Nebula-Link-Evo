import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AssistantCompletedEvent,
  AssistantDeltaEvent,
  AssistantStartedEvent,
  AssistantThinkingEvent,
  AssistantToolCallEvent,
  AssistantToolResultEvent,
  MessageCreatedEvent,
  RunErrorEvent,
  SessionEvent,
  SessionSnapshotEvent,
} from '@nebula-link-evo/shared/types/sse-events';

import { useChatStore } from '@/features/chat/store/chat.store.js';
import type { ChatMessage, ToolCall as LocalToolCall } from '@/features/chat/types/index.js';

// --- Constants ---
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;
const SSE_EVENT_TYPES = [
  'session.snapshot',
  'message.created',
  'assistant.started',
  'assistant.delta',
  'assistant.thinking',
  'assistant.tool_call',
  'assistant.tool_result',
  'assistant.completed',
  'run.error',
] as const;

// --- Helpers ---
function getLastEventId(sessionId: string): number | null {
  const raw = localStorage.getItem(`sse_lastEventId_${sessionId}`);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function setLastEventId(sessionId: string, seq: number): void {
  localStorage.setItem(`sse_lastEventId_${sessionId}`, String(seq));
}

function clearLastEventId(sessionId: string): void {
  localStorage.removeItem(`sse_lastEventId_${sessionId}`);
}

function backoffDelay(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** attempt, MAX_BACKOFF_MS);
}

function adaptSnapshotMessage(
  m: SessionSnapshotEvent['messages'][number],
): ChatMessage {
  return {
    id: m.id,
    role: m.role as ChatMessage['role'],
    content: m.content,
    thinking: m.thinking,
    created_at: m.created_at,
  };
}

function adaptToolCall(
  evt: AssistantToolCallEvent,
): LocalToolCall {
  const tc = evt.toolCall;
  return {
    id: evt.toolCallId ?? tc.function?.name ?? `tc-${Date.now()}`,
    name: tc.function?.name ?? 'unknown',
    arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc),
    status: 'running',
  };
}

// --- Types ---
export interface UseChatStreamOptions {
  sessionId: string | null;
  enabled?: boolean;
  allowResume?: boolean;
}

export interface UseChatStreamReturn {
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn {
  const { sessionId, enabled = true, allowResume = true } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs — mutable state that doesn't trigger re-renders
  const esRef = useRef<EventSource | null>(null);
  const contentBufferRef = useRef('');
  const thinkingBufferRef = useRef('');
  const rafHandleRef = useRef<number | null>(null);
  const highestSeqRef = useRef(-1);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSessionIdRef = useRef<string | null>(null);
  const pendingToolCallsRef = useRef<LocalToolCall[]>([]);
  const currentMessageIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // --- Flush helpers ---

  const flushBuffers = useCallback(() => {
    rafHandleRef.current = null;
    const store = useChatStore.getState();
    const content = contentBufferRef.current;
    const thinking = thinkingBufferRef.current;
    if (content) {
      store.appendStreamingContent(content);
      contentBufferRef.current = '';
    }
    if (thinking) {
      store.appendStreamingThinking(thinking);
      thinkingBufferRef.current = '';
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafHandleRef.current === null) {
      rafHandleRef.current = requestAnimationFrame(flushBuffers);
    }
  }, [flushBuffers]);

  const immediateFlush = useCallback(() => {
    if (rafHandleRef.current !== null) {
      cancelAnimationFrame(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    flushBuffers();
  }, [flushBuffers]);

  // --- Connection cleanup ---

  const cleanupConnection = useCallback(() => {
    immediateFlush();
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setIsConnected(false);
  }, [immediateFlush]);

  // --- Connect ---

  const connect = useCallback(
    (sid: string) => {
      cleanupConnection();

      const lastId = allowResume ? getLastEventId(sid) : null;

      // Initialize dedup from persisted lastEventId
      if (lastId !== null) {
        highestSeqRef.current = lastId;
      }

      let url = `/api/chat/sessions/${sid}/stream`;
      if (lastId !== null) {
        url += `?lastEventId=${lastId}`;
      }

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptRef.current = 0;
      };

      // Generic error handler triggers reconnect
      es.onerror = () => {
        setIsConnected(false);
        es.close();
        esRef.current = null;

        if (reconnectAttemptRef.current >= 5) {
          setError('Connection failed after 5 attempts.');
          useChatStore.getState().setStreamingState('error');
          return;
        }

        const delay = backoffDelay(reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          const currentSid = sessionIdRef.current;
          if (currentSid) connect(currentSid);
        }, delay);
      };

      // --- Event handlers ---

      const isDuplicate = (evt: SessionEvent): boolean => {
        if (evt.seq == null) return false;
        if (evt.seq <= highestSeqRef.current) return true;
        highestSeqRef.current = evt.seq;
        setLastEventId(sid, evt.seq);
        return false;
      };

      // session.snapshot
      es.addEventListener('session.snapshot', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as SessionSnapshotEvent;
        if (isDuplicate(evt)) return;
        const store = useChatStore.getState();
        store.setMessages(sid, evt.messages.map(adaptSnapshotMessage));
      });

      // message.created
      es.addEventListener('message.created', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as MessageCreatedEvent;
        if (isDuplicate(evt)) return;
        const msg: ChatMessage = {
          id: evt.messageId,
          role: 'user',
          content: evt.content,
          timestamp: Date.now(),
        };
        useChatStore.getState().addMessage(sid, msg);
      });

      // assistant.started
      es.addEventListener('assistant.started', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantStartedEvent;
        if (isDuplicate(evt)) return;
        const store = useChatStore.getState();
        store.resetStreaming();
        store.setStreamingState('streaming');
        pendingToolCallsRef.current = [];
        if (evt.messageId) {
          currentMessageIdRef.current = evt.messageId;
        }
      });

      // assistant.delta — batched
      es.addEventListener('assistant.delta', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantDeltaEvent;
        if (isDuplicate(evt)) return;
        contentBufferRef.current += evt.text;
        scheduleFlush();
      });

      // assistant.thinking — batched
      es.addEventListener('assistant.thinking', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantThinkingEvent;
        if (isDuplicate(evt)) return;
        thinkingBufferRef.current += evt.text;
        scheduleFlush();
      });

      // assistant.tool_call
      es.addEventListener('assistant.tool_call', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantToolCallEvent;
        if (isDuplicate(evt)) return;
        const localTc = adaptToolCall(evt);
        pendingToolCallsRef.current = [
          ...pendingToolCallsRef.current,
          localTc,
        ];
        const mid = evt.messageId ?? currentMessageIdRef.current;
        if (mid) {
          const store = useChatStore.getState();
          const msgs = store.messagesBySession[sid] ?? [];
          const existing = msgs.find((m) => m.id === mid);
          if (existing) {
            store.updateMessage(sid, mid, {
              toolCalls: [...(existing.toolCalls ?? []), localTc],
            });
          }
        }
      });

      // assistant.tool_result
      es.addEventListener('assistant.tool_result', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantToolResultEvent;
        if (isDuplicate(evt)) return;
        const mid = evt.messageId ?? currentMessageIdRef.current;
        const tcId = evt.toolCallId;
        if (mid && tcId) {
          const store = useChatStore.getState();
          const msgs = store.messagesBySession[sid] ?? [];
          const existing = msgs.find((m) => m.id === mid);
          if (existing?.toolCalls) {
            const updated = existing.toolCalls.map((tc) =>
              tc.id === tcId
                ? { ...tc, result: evt.result, status: 'completed' as const }
                : tc,
            );
            store.updateMessage(sid, mid, { toolCalls: updated });
          }
        }
      });

      // assistant.completed
      es.addEventListener('assistant.completed', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantCompletedEvent;
        if (isDuplicate(evt)) return;
        immediateFlush();

        const store = useChatStore.getState();
        store.flushStreamingToMessage(sid);

        // Attach pending tool calls to the just-flushed message
        if (pendingToolCallsRef.current.length > 0) {
          const msgs = store.messagesBySession[sid] ?? [];
          const lastAssistant = [...msgs]
            .reverse()
            .find((m) => m.role === 'assistant');
          if (lastAssistant) {
            store.updateMessage(sid, lastAssistant.id, {
              toolCalls: pendingToolCallsRef.current,
            });
          }
          pendingToolCallsRef.current = [];
        }

        store.setStreamingState('idle');
        currentMessageIdRef.current = null;
      });

      // run.error
      es.addEventListener('run.error', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as RunErrorEvent;
        if (isDuplicate(evt)) return;
        immediateFlush();
        const store = useChatStore.getState();
        store.flushStreamingToMessage(sid);
        store.setStreamingState('error');
        setError(evt.error);
        currentMessageIdRef.current = null;
      });
    },
    [allowResume, cleanupConnection, immediateFlush, scheduleFlush],
  );

  // --- Public actions ---

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    if (sessionId) connect(sessionId);
  }, [sessionId, connect]);

  const disconnect = useCallback(() => {
    cleanupConnection();
    reconnectAttemptRef.current = 0;
    setError(null);
  }, [cleanupConnection]);

  // --- Effect: manage connection lifecycle ---

  useEffect(() => {
    if (!enabled || !sessionId) {
      cleanupConnection();
      prevSessionIdRef.current = sessionId;
      return;
    }

    // Session switch detection
    if (prevSessionIdRef.current !== sessionId) {
      if (!allowResume) {
        clearLastEventId(sessionId);
      }
      highestSeqRef.current = -1;
      pendingToolCallsRef.current = [];
      currentMessageIdRef.current = null;
    }
    prevSessionIdRef.current = sessionId;

    connect(sessionId);

    return () => {
      cleanupConnection();
    };
  }, [sessionId, enabled, allowResume, connect, cleanupConnection]);

  return { isConnected, error, reconnect, disconnect };
}

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
  ToolCall,
} from '@nebula-link-evo/shared/types/sse-events';

import { useChatStore } from '@/features/chat/store/chat.store.js';
import type { ChatMessage, ToolCall as LocalToolCall } from '@/features/chat/types/index.js';

// --- Constants ---
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

function backoffDelay(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * BACKOFF_MULTIPLIER ** attempt, MAX_BACKOFF_MS);
}

function getChatStore() {
  return typeof useChatStore.getState === 'function' ? useChatStore.getState() : null;
}

function adaptSnapshotMessage(m: SessionSnapshotEvent['messages'][number]): ChatMessage {
  return {
    id: m.id,
    role: m.role as ChatMessage['role'],
    content: m.content,
    thinking: m.thinking,
    toolCalls: m.tool_calls?.map((tc) => {
      const rec = tc as Record<string, unknown>;
      const fn = rec.function as Record<string, unknown> | undefined;
      return {
        id: (rec.id as string) ?? `tc-${Date.now()}`,
        name: fn ? (fn.name as string) : 'unknown',
        arguments: typeof fn?.arguments === 'string'
          ? (fn.arguments as string)
          : JSON.stringify(fn?.arguments ?? rec.arguments),
        result: typeof rec.result === 'string' ? rec.result : undefined,
        status: 'completed' as const,
      };
    }),
    created_at: m.created_at,
  };
}

function adaptToolCall(evt: AssistantToolCallEvent): LocalToolCall | null {
  // Protocol requires toolCallId as a non-optional string. Reject malformed
  // events at runtime — the type system can't enforce this for untrusted data.
  if (typeof evt.toolCallId !== 'string' || !evt.toolCallId) return null;
  const tc = evt.toolCall;
  const rec = tc as Record<string, unknown>;
  const fn = rec.function as Record<string, unknown> | undefined;
  return {
    id: evt.toolCallId,
    name: (fn?.name as string | undefined) ?? 'unknown',
    arguments: typeof fn?.arguments === 'string' ? (fn.arguments as string) : JSON.stringify(fn?.arguments ?? tc),
    status: 'running',
  };
}

function adaptActiveToolCall(tc: ToolCall): LocalToolCall {
  const rec = tc as Record<string, unknown>;
  const fn = rec.function as Record<string, unknown> | undefined;
  return {
    id: (rec.id as string) ?? `tc-${Date.now()}`,
    name: fn ? (fn.name as string) : 'unknown',
    arguments: typeof fn?.arguments === 'string'
      ? (fn.arguments as string)
      : JSON.stringify(fn?.arguments ?? rec.arguments),
    status: 'running',
  };
}

// --- Types ---
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

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn {
  const { sessionId, enabled = true } = options;

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
  const currentMessageIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // --- Flush helpers ---

  const flushBuffers = useCallback(() => {
    rafHandleRef.current = null;
    const store = getChatStore();
    if (!store) {
      contentBufferRef.current = '';
      thinkingBufferRef.current = '';
      return;
    }
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
    getChatStore()?.resetStreaming();
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
      highestSeqRef.current = -1;
      currentMessageIdRef.current = null;

      const es = new EventSource(`/api/chat/sessions/${sid}/stream`);
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
          getChatStore()?.setStreamingState('error');
          getChatStore()?.resetStreaming();
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
        if (evt.type === 'session.snapshot') {
          if (evt.seq != null) {
            highestSeqRef.current = evt.seq;
          }
          return false;
        }
        if (evt.seq == null) return false;
        if (evt.seq <= highestSeqRef.current) return true;
        highestSeqRef.current = evt.seq;
        return false;
      };

      // session.snapshot
      es.addEventListener('session.snapshot', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as SessionSnapshotEvent;
        if (isDuplicate(evt)) return;
        const store = getChatStore();
        if (!store) return;
        store.resetStreaming();
        if (evt.state === 'blocked') {
          store.setStreamingState('blocked');
        } else if (evt.state === 'paused') {
          store.setStreamingState('paused');
        } else {
          store.setStreamingState('idle');
        }
        store.setMessages(sid, evt.messages.map(adaptSnapshotMessage));

        // Restore in-progress tool calls from snapshot
        if (evt.activeToolCalls && evt.activeToolCalls.length > 0) {
          for (const tc of evt.activeToolCalls) {
            store.appendStreamingToolCall(adaptActiveToolCall(tc));
          }
          store.setStreamingState('streaming');
        }
      });

      // message.created
      es.addEventListener('message.created', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as MessageCreatedEvent;
        if (isDuplicate(evt)) return;
        const store = getChatStore();
        if (!store) return;

        const serverMsg: ChatMessage = {
          id: evt.messageId,
          role: 'user',
          content: evt.content,
          timestamp: Date.now(),
        };

        // Reconcile with optimistic message to avoid duplicates.
        const messages = store.messagesBySession[sid] ?? [];
        const optimistic = messages.find(
          (m) => m.id.startsWith('temp-') && m.role === 'user' && m.content === evt.content
        );
        if (optimistic) {
          store.reconcileMessage(sid, optimistic.id, serverMsg);
        } else {
          store.addMessage(sid, serverMsg);
        }
      });

      // assistant.started
      es.addEventListener('assistant.started', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantStartedEvent;
        if (isDuplicate(evt)) return;
        const store = getChatStore();
        if (!store) return;
        store.resetStreaming();
        store.setStreamingState('streaming');
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
        if (!localTc) return; // malformed — missing toolCallId
        const store = getChatStore();
        if (!store) return;
        store.appendStreamingToolCall(localTc);
      });

      // assistant.tool_result
      es.addEventListener('assistant.tool_result', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantToolResultEvent;
        if (isDuplicate(evt)) return;
        const tcId = evt.toolCallId;
        if (typeof tcId !== 'string' || tcId.length === 0) return;
        const store = getChatStore();
        if (!store) return;
        store.updateStreamingToolCallResult(tcId, evt.result);
      });

      // assistant.completed
      es.addEventListener('assistant.completed', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as AssistantCompletedEvent;
        if (isDuplicate(evt)) return;
        immediateFlush();

        const store = getChatStore();
        if (!store) return;
        // flushStreamingToMessage internally checks streamingToolCalls.length
        // and atomically includes them in the created ChatMessage.
        store.flushStreamingToMessage(sid);

        store.setStreamingState('idle');
        currentMessageIdRef.current = null;
      });

      // run.error
      es.addEventListener('run.error', (e: MessageEvent) => {
        const evt = JSON.parse(e.data) as RunErrorEvent;
        if (isDuplicate(evt)) return;
        immediateFlush();
        const store = getChatStore();
        if (!store) return;
        store.flushStreamingToMessage(sid);
        store.resetStreaming();
        store.setStreamingState('error');
        setError(evt.error);
        currentMessageIdRef.current = null;
      });
    },
    [cleanupConnection, immediateFlush, scheduleFlush]
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
      getChatStore()?.resetStreaming();
      prevSessionIdRef.current = sessionId;
      return;
    }

    if (prevSessionIdRef.current !== sessionId) {
      highestSeqRef.current = -1;
      currentMessageIdRef.current = null;
    }
    prevSessionIdRef.current = sessionId;

    connect(sessionId);

    return () => {
      cleanupConnection();
    };
  }, [sessionId, enabled, connect, cleanupConnection]);

  return { isConnected, error, reconnect, disconnect };
}

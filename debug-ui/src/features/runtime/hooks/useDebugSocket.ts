import { useCallback, useEffect, useRef } from 'react';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { queryClient } from '@/shared/query/query-client.js';
import { queryKeys } from '@/shared/query/query-keys.js';

interface ServiceStatusPayload {
  playwright?: {
    isOpen: boolean;
    url?: string;
    status?: 'healthy' | 'unhealthy';
  };
  mcp?: unknown;
}

interface ParsedMessage {
  type: string;
  [key: string]: unknown;
}

const BASE_RECONNECT_INTERVAL = 1000;
const MAX_RECONNECT_INTERVAL = 30000;
const MAX_RECONNECT_ATTEMPTS = 5;

export interface UseDebugSocketReturn {
  sendMessage: (type: string, data?: Record<string, unknown>) => void;
  pauseTask: () => void;
  resumeTask: () => void;
  singleStep: () => void;
  disconnect: () => void;
  reconnect: () => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
}

function buildWsUrl(): string {
  const protocol = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = globalThis.location?.host ?? 'localhost:3000';
  return `${protocol}//${host}/ws/debug`;
}

function computeBackoff(attempt: number): number {
  const base = Math.min(
    BASE_RECONNECT_INTERVAL * Math.pow(1.5, attempt - 1),
    MAX_RECONNECT_INTERVAL,
  );
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function useDebugSocket(): UseDebugSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const isManualCloseRef = useRef(false);
  const handlersRef = useRef(new Set<(data: unknown) => void>());
  const mountedRef = useRef(true);

  const store = useRuntimeStore;

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const dispatchToStore = useCallback((msg: ParsedMessage): void => {
    if (msg.type === 'service_status' && msg.services) {
      const services = msg.services as ServiceStatusPayload;
      if (services.playwright) {
        store.getState().setPlaywrightIsOpen(services.playwright.isOpen);
        if (services.playwright.url !== undefined) {
          store.getState().setPlaywrightUrl(services.playwright.url);
        }
        if (services.playwright.status !== undefined) {
          store.getState().setPlaywrightStatus(
            services.playwright.status === 'healthy' ? 'ready' : 'unhealthy',
          );
        }
      }
      
      // M5: Sync MCP WebSocket updates to UI by invalidating React Query cache
      if (services.mcp) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.status });
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tools });
      }
    }
  }, []);

  const notifyHandlers = useCallback((data: unknown) => {
    for (const handler of handlersRef.current) {
      handler(data);
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let parsed: ParsedMessage;
      try {
        parsed = JSON.parse(event.data as string) as ParsedMessage;
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== 'string') return;

      dispatchToStore(parsed);
      notifyHandlers(parsed);
    },
    [dispatchToStore, notifyHandlers],
  );

  const connect = useCallback(() => {
    clearReconnectTimer();
    isManualCloseRef.current = false;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!mountedRef.current) return;

    const url = buildWsUrl();
    store.getState().setConnectionStatus('connecting');

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      store.getState().setConnectionStatus('connected');
      store.getState().resetReconnectAttempt();
      attemptRef.current = 0;
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      if (!mountedRef.current) return;
      wsRef.current = null;
      store.getState().setConnectionStatus('disconnected');

      if (isManualCloseRef.current) return;

      attemptRef.current += 1;
      if (attemptRef.current > MAX_RECONNECT_ATTEMPTS) return;

      store.getState().setConnectionStatus('reconnecting');
      store.getState().setReconnectAttempt(attemptRef.current);

      const delay = computeBackoff(attemptRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !isManualCloseRef.current) {
          connect();
        }
      }, delay);
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnection is handled there
    };
  }, [clearReconnectTimer, handleMessage]);

  const sendMessage = useCallback(
    (type: string, data?: Record<string, unknown>) => {
      const whitelist = ['pause', 'resume', 'step', 'start', 'stop', 'cancel', 'status', 'ping', 'config'];
      if (!whitelist.includes(type)) {
        console.warn(`WebSocket command '${type}' is not in whitelist.`);
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type, ...data }));
    },
    [],
  );

  const pauseTask = useCallback(() => sendMessage('pause'), [sendMessage]);
  const resumeTask = useCallback(() => sendMessage('resume'), [sendMessage]);
  const singleStep = useCallback(() => sendMessage('step'), [sendMessage]);

  const disconnect = useCallback(() => {
    isManualCloseRef.current = true;
    clearReconnectTimer();
    attemptRef.current = 0;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    store.getState().setConnectionStatus('disconnected');
    store.getState().resetReconnectAttempt();
  }, [clearReconnectTimer]);

  const reconnect = useCallback(() => {
    disconnect();
    // Reset manual close flag so reconnect can proceed
    isManualCloseRef.current = false;
    attemptRef.current = 0;
    store.getState().resetReconnectAttempt();
    connect();
  }, [connect, disconnect]);

  const onMessage = useCallback((handler: (data: unknown) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      isManualCloseRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      store.getState().setConnectionStatus('disconnected');
    };
  }, [clearReconnectTimer, connect]);

  return { sendMessage, pauseTask, resumeTask, singleStep, disconnect, reconnect, onMessage };
}

import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Type-safe event map — covers ALL events used across all features
export interface SSEEventMap {
  // Analysis
  'prd.analysis_progress': { phase?: string; progress?: number; message?: string };
  'prd.analysis_complete': { moduleCount?: number };
  'prd.decomposition_complete': { moduleId: string };
  'prd.decomposition_all_complete': { totalModules: number };
  'prd.scenarios_all_complete': { totalScenarios: number };
  // Exploration
  'exploration.progress': { pagesVisited: number; urlsFound: number; currentUrl?: string };
  'exploration.url_found': { url: string; id: string };
  'exploration.binding_proposed': { bindingId: string; moduleId: string; urlId: string };
  'exploration.complete': { urlsCount: number };
  // Execution
  'execution.started': { scriptId: string; runId?: string };
  'execution.progress': { step: string; progress?: number; runId?: string };
  'execution.completed': { run?: { id: string; [key: string]: unknown }; scriptId?: string };
  'execution.failed': { error: string; runId?: string };
  'ai.diagnosis': { runId: string; diagnosis: string; severity: string };
  'ai.fix_applied': { fixId: string; status: string };
  // Scripts
  'script.generation_progress': { moduleId: string; progress?: number };
  'script.generated': { scriptId: string; moduleId: string };
  // Project
  'project.status_changed': { status: string; [key: string]: unknown };
}

export type SSEHandlers = {
  [K in keyof SSEEventMap]?: (data: SSEEventMap[K]) => void;
};

export interface UseSSEOptions {
  projectId: string;
  handlers: SSEHandlers;
  enabled?: boolean;
}

export function useSSE({ projectId, handlers, enabled = true }: UseSSEOptions) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const handlersRef = useRef(handlers);

  // Keep handlers ref up to date without re-triggering effect
  handlersRef.current = handlers;

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setStatus('disconnected');
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !projectId) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus('connecting');
    setError(null);

    const url = `/api/projects/${projectId}/events`;

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('connected');
        retryCountRef.current = 0;
      };

      es.onerror = () => {
        setStatus('error');
        setError(new Error('SSE connection error'));

        es.close();
        eventSourceRef.current = null;

        // Auto reconnect
        if (retryCountRef.current < 5) {
          retryCountRef.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, 3000);
        } else {
          setStatus('disconnected');
        }
      };

      // Register typed event listeners from handlers
      const eventTypes = Object.keys(handlersRef.current) as (keyof SSEEventMap)[];
      for (const eventType of eventTypes) {
        es.addEventListener(eventType, (event) => {
          try {
            const parsed = JSON.parse((event as MessageEvent).data);
            const handler = handlersRef.current[eventType];
            handler?.(parsed.data);
          } catch {
            // Silently handle parse errors — invalid data is ignored
          }
        });
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [projectId, enabled, disconnect]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return {
    status,
    error,
    reconnect: connect,
    disconnect,
  };
}

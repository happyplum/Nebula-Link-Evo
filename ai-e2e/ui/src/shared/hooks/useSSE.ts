import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseSSEOptions<T> {
  url: string;
  events?: string[];  // Named event types to listen for
  onSnapshot?: (data: T) => void;
  onUpdate?: (event: string, data: any) => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxRetries?: number;
  enabled?: boolean;
}

export function useSSE<T>({
  url,
  events,
  onSnapshot,
  onUpdate,
  onError,
  reconnectInterval = 3000,
  maxRetries = 5,
  enabled = true,
}: UseSSEOptions<T>) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<Error | null>(null);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!enabled || !url) return;

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus('connecting');
    setError(null);

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setStatus('connected');
        retryCountRef.current = 0;
      };

      es.onerror = (err) => {
        setStatus('error');
        setError(new Error('SSE connection error'));
        onError?.(err);

        es.close();
        eventSourceRef.current = null;

        // Auto reconnect
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current += 1;
          reconnectTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          setStatus('disconnected');
        }
      };

      // Register named event listeners for specified event types
      for (const eventType of (events || [])) {
        es.addEventListener(eventType, (event) => {
          try {
            const parsed = JSON.parse(event.data);
            onUpdate?.(eventType, parsed.data);
          } catch {
            // Silently handle parse errors - invalid data is ignored
          }
        });
      }

      // Handle snapshot event (full state replacement)
      // Backend sends this as 'project.status_changed' event
      es.addEventListener('project.status_changed', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          onSnapshot?.(parsed.data);
        } catch {
          // Silently handle parse errors - invalid data is ignored
        }
      });

    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [url, events, enabled, maxRetries, reconnectInterval, onSnapshot, onUpdate, onError]);

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

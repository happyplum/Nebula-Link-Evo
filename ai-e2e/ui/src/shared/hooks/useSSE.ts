import { useEffect, useRef, useState, useCallback } from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseSSEOptions<T> {
  url: string;
  onSnapshot?: (data: T) => void;
  onUpdate?: (event: string, data: any) => void;
  onError?: (error: Event) => void;
  reconnectInterval?: number;
  maxRetries?: number;
  enabled?: boolean;
}

export function useSSE<T>({
  url,
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
        console.error(`SSE Error (${url}):`, err);
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

      // Handle snapshot event (full state replacement)
      es.addEventListener('snapshot', (event) => {
        try {
          const data = JSON.parse(event.data);
          onSnapshot?.(data);
        } catch (e) {
          console.error('Failed to parse snapshot data:', e);
        }
      });

      // Handle generic message events
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // If it has a type field, we can treat it as a specific update
          if (data.type) {
            onUpdate?.(data.type, data);
          } else {
            onUpdate?.('message', data);
          }
        } catch (e) {
          console.error('Failed to parse message data:', e);
        }
      };

      // We can also listen to specific custom events if needed,
      // but typically the backend sends 'snapshot' and then other events.
      // The user of this hook can pass onUpdate to handle them.

    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [url, enabled, maxRetries, reconnectInterval, onSnapshot, onUpdate, onError]);

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

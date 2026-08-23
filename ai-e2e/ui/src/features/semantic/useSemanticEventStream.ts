import { useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

interface ParsedEvent {
  event: string;
  data: unknown;
}

export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting';

export function parseSseBlock(block: string): ParsedEvent | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join('\n')) as unknown };
  } catch {
    return null;
  }
}

export function useSemanticEventStream<T>({
  enabled,
  endpoint,
  snapshotEvent,
  queryKey,
}: {
  enabled: boolean;
  endpoint: string;
  snapshotEvent: 'authoring.snapshot' | 'run.snapshot';
  queryKey: QueryKey;
}): StreamState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('idle');

  useEffect(() => {
    if (!enabled) {
      setState('idle');
      return;
    }
    const controller = new AbortController();
    let reconnectTimer: number | undefined;
    let stopped = false;

    const connect = async () => {
      setState((current) => (current === 'idle' ? 'connecting' : 'reconnecting'));
      try {
        const response = await fetch(endpoint, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
        setState('live');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const parsed = parseSseBlock(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            if (parsed?.event === snapshotEvent) {
              const envelope = parsed.data as { snapshot?: T };
              if (envelope.snapshot) queryClient.setQueryData<T>(queryKey, envelope.snapshot);
            } else if (parsed && parsed.event !== 'stream.error') {
              void queryClient.invalidateQueries({ queryKey });
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1_000);
      } catch {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1_000);
      }
    };

    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [enabled, endpoint, queryClient, queryKey, snapshotEvent]);

  return state;
}

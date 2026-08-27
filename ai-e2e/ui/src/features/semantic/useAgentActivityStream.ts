import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { reduceAgentStream } from '@nebula-link-evo/agent-activity-ui';

export function useAgentActivityStream({
  endpoint,
  enabled,
}: {
  endpoint: string;
  enabled: boolean;
}): AgentStreamSnapshotV1 | null {
  const [snapshot, setSnapshot] = useState<AgentStreamSnapshotV1 | null>(null);
  const pendingRef = useRef<AgentStreamEventV1[]>([]);
  const frameRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = [];
    if (!pending.length) return;
    setSnapshot((current) => (current ? pending.reduce(reduceAgentStream, current) : current));
  }, []);

  useEffect(() => {
    setSnapshot(null);
    pendingRef.current = [];
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(endpoint);
    const onSnapshot = (raw: MessageEvent) => {
      const value = parseEventData(raw.data);
      if (isAgentStreamSnapshot(value)) setSnapshot(value);
    };
    const onEvent = (raw: MessageEvent) => {
      const value = parseEventData(raw.data);
      if (isAgentStreamEvent(value)) {
        pendingRef.current.push(value);
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(flush);
      }
    };
    source.addEventListener('agent_stream.snapshot', onSnapshot);
    source.addEventListener('agent_stream.event', onEvent);
    return () => {
      source.close();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pendingRef.current = [];
    };
  }, [enabled, endpoint, flush]);

  return snapshot;
}

function parseEventData(data: unknown): unknown {
  if (typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

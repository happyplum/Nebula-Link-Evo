import {
  useAgentStreamConnection,
  type AgentStreamConnection,
} from '@nebula-link-evo/agent-stream-client';
import { useChatStore } from '@/features/chat/store/chat.store.js';

export interface UseChatStreamOptions {
  sessionId: string | null;
  enabled?: boolean;
}

export function useChatStream({
  sessionId,
  enabled = true,
}: UseChatStreamOptions): AgentStreamConnection {
  return useAgentStreamConnection({
    endpoint: `/api/v1/chat/sessions/${encodeURIComponent(sessionId ?? '')}/stream`,
    streamId: sessionId ?? '',
    enabled: enabled && Boolean(sessionId),
    onSnapshot: (snapshot) =>
      useChatStore.getState().setActivitySnapshot(snapshot.streamId, snapshot),
    onEvents: (events) => {
      const store = useChatStore.getState();
      for (const event of events) store.applyActivityEvent(event.streamId, event);
    },
  });
}

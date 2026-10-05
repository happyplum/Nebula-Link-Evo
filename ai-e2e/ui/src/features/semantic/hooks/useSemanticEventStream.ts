import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useSnapshotEventConnection } from '@nebula-link-evo/agent-stream-client';

export type StreamState = 'idle' | 'connecting' | 'live' | 'reconnecting';

/**
 * Semantic invalidation stream over the shared snapshot-event transport.
 * Cache contract: a snapshot replaces the query cache; any other named
 * event except `stream.error` invalidates the query.
 */
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
  const { status } = useSnapshotEventConnection<T>({
    endpoint,
    contextKey: endpoint,
    enabled,
    snapshotEvent,
    onSnapshot: (snapshot) => {
      queryClient.setQueryData<T>(queryKey, snapshot);
    },
    onEvent: (eventName) => {
      if (eventName !== 'stream.error') void queryClient.invalidateQueries({ queryKey });
    },
  });
  return status === 'disconnected' ? 'idle' : status;
}

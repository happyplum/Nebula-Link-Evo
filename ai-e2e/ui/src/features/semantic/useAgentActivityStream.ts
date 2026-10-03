import { useState } from 'react';
import { useAgentStreamConnection } from '@nebula-link-evo/agent-stream-client';
import type { AgentStreamSnapshotV1 } from '@nebula-link-evo/shared/types/agent-stream';
import { reduceAgentStream } from '@nebula-link-evo/agent-activity-ui';

export function useAgentActivityStream({
  endpoint,
  streamId,
  enabled,
}: {
  endpoint: string;
  streamId: string;
  enabled: boolean;
}) {
  const [activity, setActivity] = useState<{
    endpoint: string;
    streamId: string;
    snapshot: AgentStreamSnapshotV1;
  } | null>(null);
  const connection = useAgentStreamConnection({
    endpoint,
    streamId,
    enabled,
    onSnapshot: (snapshot) => setActivity({ endpoint, streamId, snapshot }),
    onEvents: (events) =>
      setActivity((current) =>
        current?.endpoint === endpoint && current.streamId === streamId
          ? { ...current, snapshot: events.reduce(reduceAgentStream, current.snapshot) }
          : current
      ),
  });
  return {
    ...connection,
    snapshot:
      activity?.endpoint === endpoint && activity.streamId === streamId ? activity.snapshot : null,
  };
}

export const AGENT_STREAM_SNAPSHOT_SCHEMA = 'nebula.ai.agent-stream.snapshot/1.0' as const;
export const AGENT_STREAM_EVENT_SCHEMA = 'nebula.ai.agent-stream.event/1.0' as const;

export type AgentStreamState =
  | 'idle'
  | 'streaming'
  | 'recovering'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentStreamActivityKind =
  | 'skill'
  | 'tool'
  | 'browser'
  | 'agent'
  | 'evidence'
  | 'read'
  | 'search'
  | 'edit'
  | 'command'
  | 'mcp';

export type AgentStreamActivityState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'skipped'
  | 'outcome_unknown';

export interface AgentStreamUsageV1 {
  inputTokens?: number;
  outputTokens?: number;
  budgetUsed?: number;
  budgetLimit?: number;
  durationMs?: number;
}

interface AgentStreamSectionBaseV1 {
  sectionId: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentStreamSectionV1 =
  | (AgentStreamSectionBaseV1 & {
      type: 'user' | 'content';
      markdown: string;
      streaming?: boolean;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'reasoning';
      visibility: 'summary' | 'public' | 'redacted';
      summary: string;
      markdown?: string;
      state: 'running' | 'completed' | 'failed';
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'activity';
      kind: AgentStreamActivityKind;
      state: AgentStreamActivityState;
      title: string;
      summary?: string;
      version?: string;
      contentHash?: string;
      usage?: AgentStreamUsageV1;
      artifactRefs?: string[];
      parentAgentId?: string;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'plan';
      title?: string;
      items: Array<{
        id: string;
        label: string;
        state: AgentStreamActivityState;
      }>;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'decision';
      title: string;
      summary?: string;
      state: 'waiting' | 'approved' | 'rejected' | 'expired';
      decisionId?: string;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'agent';
      agentId: string;
      name: string;
      state: AgentStreamActivityState;
      summary?: string;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'media';
      mediaType: 'image' | 'video' | 'audio';
      title: string;
      artifactRef: string;
      alt?: string;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'file';
      name: string;
      artifactRef: string;
      mimeType?: string;
      size?: number;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'notice';
      tone: 'info' | 'success' | 'warning';
      title: string;
      message?: string;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'error';
      title: string;
      message: string;
      code?: string;
      recoverable?: boolean;
    })
  | (AgentStreamSectionBaseV1 & {
      type: 'turn-summary';
      summary: string;
      usage?: AgentStreamUsageV1;
    });

export interface AgentStreamTurnV1 {
  turnId: string;
  role: 'user' | 'assistant' | 'system';
  state: 'streaming' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  sections: AgentStreamSectionV1[];
}

export interface AgentStreamSnapshotV1 {
  schema: typeof AGENT_STREAM_SNAPSHOT_SCHEMA;
  streamId: string;
  seq: number;
  state: AgentStreamState;
  generatedAt: string;
  turns: AgentStreamTurnV1[];
}

interface AgentStreamEventBaseV1 {
  schema: typeof AGENT_STREAM_EVENT_SCHEMA;
  streamId: string;
  turnId: string;
  sectionId: string;
  seq: number;
  occurredAt: string;
}

export type AgentStreamEventV1 =
  | (AgentStreamEventBaseV1 & {
      type: 'stream.state';
      state: AgentStreamState;
    })
  | (AgentStreamEventBaseV1 & {
      type: 'turn.upsert';
      turn: AgentStreamTurnV1;
    })
  | (AgentStreamEventBaseV1 & {
      type: 'section.upsert';
      section: AgentStreamSectionV1;
    })
  | (AgentStreamEventBaseV1 & {
      type: 'content.delta';
      delta: string;
    })
  | (AgentStreamEventBaseV1 & {
      type: 'section.remove';
    })
  | (AgentStreamEventBaseV1 & {
      type: 'turn.completed';
      state: Extract<AgentStreamTurnV1['state'], 'completed' | 'failed' | 'cancelled'>;
    });

export function isAgentStreamSnapshot(value: unknown): value is AgentStreamSnapshotV1 {
  if (!isRecord(value)) return false;
  const snapshot = value;
  return (
    snapshot.schema === AGENT_STREAM_SNAPSHOT_SCHEMA &&
    typeof snapshot.streamId === 'string' &&
    Number.isSafeInteger(snapshot.seq) &&
    Number(snapshot.seq) >= 0 &&
    isStreamState(snapshot.state) &&
    typeof snapshot.generatedAt === 'string' &&
    Array.isArray(snapshot.turns) &&
    snapshot.turns.every(isTurn)
  );
}

export function isAgentStreamEvent(value: unknown): value is AgentStreamEventV1 {
  if (!isRecord(value)) return false;
  const event = value;
  const validBase =
    event.schema === AGENT_STREAM_EVENT_SCHEMA &&
    typeof event.streamId === 'string' &&
    typeof event.turnId === 'string' &&
    typeof event.sectionId === 'string' &&
    Number.isSafeInteger(event.seq) &&
    Number(event.seq) >= 0 &&
    typeof event.occurredAt === 'string' &&
    typeof event.type === 'string';
  if (!validBase) return false;
  switch (event.type) {
    case 'stream.state':
      return isStreamState(event.state);
    case 'turn.upsert':
      return isTurn(event.turn) && event.turn.turnId === event.turnId;
    case 'section.upsert':
      return isSection(event.section) && event.section.sectionId === event.sectionId;
    case 'content.delta':
      return typeof event.delta === 'string';
    case 'section.remove':
      return true;
    case 'turn.completed':
      return ['completed', 'failed', 'cancelled'].includes(String(event.state));
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamState(value: unknown): value is AgentStreamState {
  return ['idle', 'streaming', 'recovering', 'paused', 'completed', 'failed', 'cancelled'].includes(
    String(value)
  );
}

function isTurn(value: unknown): value is AgentStreamTurnV1 {
  if (!isRecord(value)) return false;
  return (
    typeof value.turnId === 'string' &&
    ['user', 'assistant', 'system'].includes(String(value.role)) &&
    ['streaming', 'completed', 'failed', 'cancelled'].includes(String(value.state)) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.sections) &&
    value.sections.every(isSection)
  );
}

function isSection(value: unknown): value is AgentStreamSectionV1 {
  if (
    !isRecord(value) ||
    typeof value.type !== 'string' ||
    typeof value.sectionId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return false;
  }
  switch (value.type) {
    case 'user':
    case 'content':
      return typeof value.markdown === 'string';
    case 'reasoning':
      return (
        ['summary', 'public', 'redacted'].includes(String(value.visibility)) &&
        typeof value.summary === 'string' &&
        ['running', 'completed', 'failed'].includes(String(value.state)) &&
        (value.markdown === undefined || typeof value.markdown === 'string')
      );
    case 'activity':
      return (
        [
          'skill',
          'tool',
          'browser',
          'agent',
          'evidence',
          'read',
          'search',
          'edit',
          'command',
          'mcp',
        ].includes(String(value.kind)) &&
        [
          'queued',
          'running',
          'completed',
          'failed',
          'blocked',
          'cancelled',
          'skipped',
          'outcome_unknown',
        ].includes(String(value.state)) &&
        typeof value.title === 'string' &&
        (value.summary === undefined ||
          (typeof value.summary === 'string' && value.summary.length <= 4096)) &&
        isOptionalString(value.version) &&
        isOptionalString(value.contentHash) &&
        isOptionalUsage(value.usage) &&
        (value.artifactRefs === undefined ||
          (Array.isArray(value.artifactRefs) &&
            value.artifactRefs.every((item) => typeof item === 'string'))) &&
        isOptionalString(value.parentAgentId)
      );
    case 'plan':
      return (
        Array.isArray(value.items) &&
        value.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === 'string' &&
            typeof item.label === 'string' &&
            [
              'queued',
              'running',
              'completed',
              'failed',
              'blocked',
              'cancelled',
              'skipped',
              'outcome_unknown',
            ].includes(String(item.state))
        )
      );
    case 'decision':
      return (
        typeof value.title === 'string' &&
        ['waiting', 'approved', 'rejected', 'expired'].includes(String(value.state)) &&
        isOptionalString(value.summary) &&
        isOptionalString(value.decisionId)
      );
    case 'agent':
      return (
        typeof value.agentId === 'string' &&
        typeof value.name === 'string' &&
        [
          'queued',
          'running',
          'completed',
          'failed',
          'blocked',
          'cancelled',
          'skipped',
          'outcome_unknown',
        ].includes(String(value.state)) &&
        isOptionalString(value.summary)
      );
    case 'media':
      return (
        ['image', 'video', 'audio'].includes(String(value.mediaType)) &&
        typeof value.title === 'string' &&
        typeof value.artifactRef === 'string' &&
        isOptionalString(value.alt)
      );
    case 'file':
      return (
        typeof value.name === 'string' &&
        typeof value.artifactRef === 'string' &&
        isOptionalString(value.mimeType) &&
        (value.size === undefined || (Number.isSafeInteger(value.size) && Number(value.size) >= 0))
      );
    case 'notice':
      return (
        ['info', 'success', 'warning'].includes(String(value.tone)) &&
        typeof value.title === 'string' &&
        isOptionalString(value.message)
      );
    case 'error':
      return (
        typeof value.title === 'string' &&
        typeof value.message === 'string' &&
        isOptionalString(value.code) &&
        (value.recoverable === undefined || typeof value.recoverable === 'boolean')
      );
    case 'turn-summary':
      return typeof value.summary === 'string' && isOptionalUsage(value.usage);
    default:
      return false;
  }
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalUsage(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return ['inputTokens', 'outputTokens', 'budgetUsed', 'budgetLimit', 'durationMs'].every(
    (key) =>
      value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]))
  );
}

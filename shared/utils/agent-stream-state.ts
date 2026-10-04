import type { AgentTaskStatus } from '../types/agent-task.js';
import type { AgentStreamActivityState, AgentStreamState } from '../types/agent-stream.js';

export function mapChatRuntimeStateToAgentStreamState(status: string): AgentStreamState {
  switch (status) {
    case 'running':
      return 'streaming';
    case 'paused':
    case 'blocked':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'interrupted':
      return 'recovering';
    default:
      return 'idle';
  }
}

export function mapAgentTaskStatusToAgentStreamState(status: AgentTaskStatus): AgentStreamState {
  switch (status) {
    case 'running':
    case 'created':
      return 'streaming';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'paused':
    case 'blocked':
      return 'paused';
    case 'interrupted':
      return 'recovering';
    default:
      throw new Error(`Unsupported AgentTaskStatus: ${String(status satisfies never)}`);
  }
}

export function mapSemanticStatusToActivityState(value: unknown): AgentStreamActivityState {
  if (
    value === 'created' ||
    value === 'ready' ||
    value === 'pending' ||
    value === 'waiting_dependencies'
  )
    return 'queued';
  if (value === 'running' || value === 'verifying') return 'running';
  if (value === 'completed' || value === 'passed' || value === 'succeeded' || value === 'activated')
    return 'completed';
  if (value === 'failed' || value === 'invalid') return 'failed';
  if (value === 'paused' || value === 'blocked' || value === 'waiting_decision') return 'blocked';
  if (value === 'cancelled' || value === 'cancelling' || value === 'rejected') return 'cancelled';
  if (value === 'skipped') return 'skipped';
  if (value === 'interrupted' || value === 'outcome_unknown') return 'outcome_unknown';
  return 'completed';
}

export function mapAgentActivitySnapshotState(
  activityStates: readonly AgentStreamActivityState[],
  eventCount: number
): AgentStreamState {
  if (activityStates.some((state) => state === 'running' || state === 'queued')) return 'streaming';
  if (activityStates.some((state) => state === 'blocked')) return 'paused';
  if (activityStates.some((state) => state === 'outcome_unknown')) return 'recovering';
  if (activityStates.some((state) => state === 'failed')) return 'failed';
  return eventCount ? 'completed' : 'idle';
}

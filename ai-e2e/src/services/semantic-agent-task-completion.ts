import type { AgentTaskView } from '../infrastructure/agent-task-client.js';

const TERMINAL_AGENT_STATES = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'blocked',
]);

export interface AgentTaskCompletion {
  result:
    | 'succeeded'
    | 'assertion_failed'
    | 'execution_failed'
    | 'precondition_blocked'
    | 'recoverable_interruption'
    | 'decision_required'
    | 'outcome_unknown'
    | 'cancelled';
  reasonClass: string;
  summary: string;
  checkpoint?: Record<string, unknown>;
  actualPage?: Record<string, unknown>;
  confirmedOutputs?: Record<string, unknown>;
  partialOutputs?: Record<string, unknown>;
  sideEffects?: Record<string, unknown>;
  downstreamImpact?: Record<string, unknown>;
}

export function desiredAgentCommand(
  runLifecycle: string,
  agentStatus: string
): 'pause' | 'resume' | 'cancel' | null {
  if (runLifecycle === 'cancelling' && !TERMINAL_AGENT_STATES.has(agentStatus)) return 'cancel';
  if (runLifecycle === 'paused' && agentStatus === 'running') return 'pause';
  if (runLifecycle === 'running' && agentStatus === 'paused') return 'resume';
  return null;
}

export function completionFromTask(task: AgentTaskView): AgentTaskCompletion {
  if (task.status === 'interrupted') {
    return {
      result: 'recoverable_interruption',
      reasonClass: task.error?.code ?? 'agent_interrupted',
      summary: task.error?.message ?? 'Agent task interrupted',
    };
  }
  if (task.status === 'cancelled') {
    return { result: 'cancelled', reasonClass: 'run_cancelled', summary: 'Agent task cancelled' };
  }
  if (task.status === 'blocked') {
    return {
      result: 'precondition_blocked',
      reasonClass: task.error?.code ?? 'agent_blocked',
      summary: task.error?.message ?? 'Agent task blocked',
    };
  }
  if (task.status === 'failed') {
    const unknown = task.toolCalls.some((call) => call.status === 'outcome_unknown');
    return {
      result: unknown ? 'outcome_unknown' : 'execution_failed',
      reasonClass: task.error?.code ?? (unknown ? 'browser_outcome_unknown' : 'agent_failed'),
      summary: task.error?.message ?? 'Agent task failed',
    };
  }
  const output = objectValue(task.output);
  const boundedFields = [
    [output.reasonClass, 200],
    [output.summary, 4_000],
    [output.checkpointJson, 100_000],
    [output.actualPageJson, 100_000],
    [output.confirmedOutputsJson, 100_000],
    [output.partialOutputsJson, 100_000],
    [output.sideEffectsJson, 100_000],
    [output.downstreamImpactJson, 100_000],
  ] as const;
  if (boundedFields.some(([value, maxBytes]) => !isOptionalBoundedString(value, maxBytes))) {
    return {
      result: 'execution_failed',
      reasonClass: 'invalid_agent_output',
      summary: 'Agent task returned an oversized or invalid output field',
    };
  }
  const allowed = new Set([
    'succeeded',
    'assertion_failed',
    'execution_failed',
    'precondition_blocked',
    'decision_required',
    'outcome_unknown',
  ]);
  const result =
    typeof output.result === 'string' && allowed.has(output.result)
      ? (output.result as Exclude<
          AgentTaskCompletion['result'],
          'recoverable_interruption' | 'cancelled'
        >)
      : 'execution_failed';
  return {
    result,
    reasonClass: stringValue(output.reasonClass) ?? 'invalid_agent_output',
    summary: stringValue(output.summary) ?? 'Agent task returned an invalid result',
    ...optionalJsonObject(output.checkpointJson, 'checkpoint'),
    ...optionalJsonObject(output.actualPageJson, 'actualPage'),
    ...optionalJsonObject(output.confirmedOutputsJson, 'confirmedOutputs'),
    ...optionalJsonObject(output.partialOutputsJson, 'partialOutputs'),
    ...optionalJsonObject(output.sideEffectsJson, 'sideEffects'),
    ...optionalJsonObject(output.downstreamImpactJson, 'downstreamImpact'),
  };
}

function optionalJsonObject(value: unknown, key: string): Record<string, Record<string, unknown>> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { [key]: parsed as Record<string, unknown> }
      : {};
  } catch {
    return {};
  }
}

function isOptionalBoundedString(value: unknown, maxBytes: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maxBytes)
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

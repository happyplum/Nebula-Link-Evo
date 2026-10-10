import { describe, expect, it } from 'vitest';
import {
  mapAgentActivitySnapshotState,
  mapAgentTaskStatusToAgentStreamState,
  mapChatRuntimeStateToAgentStreamState,
  mapSemanticStatusToActivityState,
} from '../agent-stream-state.js';

describe('Agent Stream domain state mappings', () => {
  it.each([
    ['running', 'streaming'],
    ['paused', 'paused'],
    ['blocked', 'paused'],
    ['completed', 'completed'],
    ['interrupted', 'recovering'],
    ['cancelled', 'idle'],
    ['failed', 'idle'],
    ['created', 'idle'],
  ] as const)('matches the Chat runtime mapper for %s', (status, expected) => {
    expect(mapChatRuntimeStateToAgentStreamState(status)).toBe(expected);
  });

  it.each([
    ['created', 'streaming'],
    ['running', 'streaming'],
    ['paused', 'paused'],
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['interrupted', 'recovering'],
    ['cancelled', 'cancelled'],
    ['blocked', 'paused'],
  ] as const)('matches the Agent Task activity projector for %s', (status, expected) => {
    expect(mapAgentTaskStatusToAgentStreamState(status)).toBe(expected);
  });

  it.each([
    ['created', 'queued'],
    ['ready', 'queued'],
    ['pending', 'queued'],
    ['waiting_dependencies', 'queued'],
    ['running', 'running'],
    ['verifying', 'running'],
    ['completed', 'completed'],
    ['passed', 'completed'],
    ['succeeded', 'completed'],
    ['activated', 'completed'],
    ['failed', 'failed'],
    ['invalid', 'failed'],
    ['paused', 'blocked'],
    ['blocked', 'blocked'],
    ['waiting_decision', 'blocked'],
    ['cancelled', 'cancelled'],
    ['cancelling', 'cancelled'],
    ['rejected', 'cancelled'],
    ['skipped', 'skipped'],
    ['interrupted', 'outcome_unknown'],
    ['outcome_unknown', 'outcome_unknown'],
    [undefined, 'completed'],
    [null, 'completed'],
    [42, 'completed'],
    ['future-status', 'completed'],
  ] as const)('matches the semantic repository status mapper for %s', (value, expected) => {
    expect(mapSemanticStatusToActivityState(value)).toBe(expected);
  });

  it.each([
    [['running', 'blocked', 'failed'], 3, 'streaming'],
    [['blocked', 'outcome_unknown', 'failed'], 3, 'paused'],
    [['outcome_unknown', 'failed'], 2, 'recovering'],
    [['failed', 'cancelled'], 2, 'failed'],
    [['completed', 'cancelled', 'skipped'], 3, 'completed'],
    [['cancelled'], 1, 'completed'],
    [[], 1, 'completed'],
    [[], 0, 'idle'],
  ] as const)('matches the activity snapshot heuristic', (states, eventCount, expected) => {
    expect(mapAgentActivitySnapshotState(states, eventCount)).toBe(expected);
  });
});

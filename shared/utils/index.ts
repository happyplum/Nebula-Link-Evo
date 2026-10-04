/**
 * Shared utility modules
 *
 * Central export point for all shared utilities
 */

export { createFrameCounter } from './frame-counter.js';
export type { FrameCounter, FrameCounterSummary } from './frame-counter.js';

export { createEmptyAgentStream, reduceAgentStream, replayAgentStream } from './agent-stream.js';

export {
  mapAgentActivitySnapshotState,
  mapAgentTaskStatusToAgentStreamState,
  mapChatRuntimeStateToAgentStreamState,
  mapSemanticStatusToActivityState,
} from './agent-stream-state.js';

export { encodeSseJsonFrame } from './sse-frame.js';
export type { SseFrameField, SseJsonFrameOptions } from './sse-frame.js';
export { SnapshotFirstSseWriter } from './snapshot-first-sse.js';
export type {
  SseLifecycleEvent,
  SseLifecycleTarget,
  SsePollOptions,
  SseUnsubscribe,
  SseWriteTarget,
  SnapshotFirstSseFeed,
  SnapshotFirstSseWriterOptions,
} from './snapshot-first-sse.js';

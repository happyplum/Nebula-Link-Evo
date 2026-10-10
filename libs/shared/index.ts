/**
 * @nebula-link-evo/shared
 *
 * Central entry point for shared types and utilities.
 * Re-exports all public modules for convenient imports.
 */

// Types module
export * from './types/index.js';

// Constants
export { MAX_SCREENSHOT_SIZE_BYTES } from './types/constants.js';

// Debug SSE Events
export type {
  DebugStreamEvent,
  DebugPlaywrightState,
  DebugServiceStatus,
  DebugStatusReason,
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugErrorEvent,
  DebugMarkerEvent,
  DebugMarkerPayload,
  DebugOverlayEvent,
  DebugOverlayPayload,
  DebugMcpInvalidatedEvent,
  DebugKeepaliveEvent,
} from './types/debug-events.js';

// Utilities module
export * from './utils/index.js';

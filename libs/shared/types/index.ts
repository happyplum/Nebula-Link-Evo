/**
 * Shared Types Index
 *
 * Central export point for all shared type definitions.
 * This module re-exports all types from the shared/types directory.
 */
// Vision Marker types (DOM, elements, locators)
export type {
  BoundingBox,
  LocatorBundle,
  ElementLocator,
  SimplifiedElement,
  SimplifiedDOM,
  DOMSnapshotResponse,
  ElementInfo,
} from './vision-marker.js';

export { VISION_MARKER_API_VERSION } from './vision-marker.js';

// Debug SSE event types
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
} from './debug-events.js';

// Constants
export { MAX_SCREENSHOT_SIZE_BYTES } from './constants.js';

// Browser execution wire contracts
export * from './browser-execution.js';

// User-facing Agent activity stream wire contracts
export * from './agent-stream.js';

// Immutable proxy-owned evidence passed to bounded Vision tools
export type {
  VisionSnapshotArtifactBindingV1,
  VisionSnapshotBindingV1,
} from './vision-snapshot.js';

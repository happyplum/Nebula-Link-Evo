/**
 * Debug SSE Event Types
 *
 * Type definitions for the debug real-time push channel.
 * These events flow from proxy-adapter → debug-ui via SSE to provide
 * live browser state, marker, overlay, and health information.
 */

import type { BoundingBox } from './vision-marker.js';

/** Health status of the debug Playwright service. */
export type DebugServiceStatus = 'unknown' | 'ready' | 'unhealthy';

/** Reason for a debug status transition. */
export type DebugStatusReason =
  | 'snapshot' | 'open' | 'close' | 'navigate' | 'switch_tab'
  | 'page_closed' | 'browser_disconnected';

/** Current state of the debug Playwright browser context. */
export interface DebugPlaywrightState {
  isOpen: boolean;
  url: string | null;
  title: string | null;
  status: DebugServiceStatus;
  viewport?: { width: number; height: number } | null;
  reason?: DebugStatusReason;
}

/** Full snapshot of debug browser state. */
export interface DebugSnapshotEvent {
  type: 'debug.snapshot';
  seq?: number;
  status: DebugPlaywrightState;
  emittedAt: string;
}

/** Incremental status change notification. */
export interface DebugStatusEvent {
  type: 'debug.status';
  seq?: number;
  status: DebugPlaywrightState;
  emittedAt: string;
}

/** Error event from the debug bridge. */
export interface DebugErrorEvent {
  type: 'debug.error';
  seq?: number;
  code: 'upstream_disconnected' | 'upstream_timeout' | 'bridge_failure';
  message: string;
  emittedAt: string;
}

/** Payload for a visual marker on the debug canvas. */
export interface DebugMarkerPayload {
  source: 'ai' | 'manual' | 'system';
  action?: 'click' | 'type' | 'focus' | 'blur' | 'hover' | 'value' | 'dispatch';
  pageX: number;
  pageY: number;
  bbox?: BoundingBox;
  selector?: string;
  snapshotId?: string;
  nebulaId?: number;
  ttlMs?: number;
}

/** Marker placement event on the debug canvas. */
export interface DebugMarkerEvent {
  type: 'debug.marker';
  seq?: number;
  marker: DebugMarkerPayload;
  emittedAt: string;
}

/** Payload for an overlay (highlight/hover) on the debug canvas. */
export interface DebugOverlayPayload {
  kind: 'highlight' | 'hover';
  source: 'ai' | 'manual' | 'system';
  bbox: BoundingBox;
  selector?: string;
  ttlMs?: number;
}

/** Overlay toggle event on the debug canvas. Null payload clears the overlay. */
export interface DebugOverlayEvent {
  type: 'debug.overlay';
  seq?: number;
  overlay: DebugOverlayPayload | null;
  emittedAt: string;
}

/** Notification that MCP cache should be invalidated. */
export interface DebugMcpInvalidatedEvent {
  type: 'debug.mcp_invalidated';
  seq?: number;
  scope: 'status' | 'tools' | 'all';
  reason: 'tool_call' | 'startup' | 'config_changed' | 'manual_refresh';
  emittedAt: string;
}

/** Keep-alive heartbeat for the debug SSE connection. */
export interface DebugKeepaliveEvent {
  type: 'debug.keepalive';
  seq?: number;
  emittedAt: string;
}

/** Discriminated union of all debug SSE stream events. */
export type DebugStreamEvent =
  | DebugSnapshotEvent | DebugStatusEvent | DebugErrorEvent | DebugMarkerEvent
  | DebugOverlayEvent | DebugMcpInvalidatedEvent | DebugKeepaliveEvent;

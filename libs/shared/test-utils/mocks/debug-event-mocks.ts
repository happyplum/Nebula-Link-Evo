import type {
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugErrorEvent,
  DebugMarkerEvent,
  DebugOverlayEvent,
  DebugMcpInvalidatedEvent,
  DebugKeepaliveEvent,
} from '../../types/debug-events.js';

/** Create a mock debug.snapshot event. */
export function mockDebugSnapshotEvent(overrides?: Partial<DebugSnapshotEvent>): DebugSnapshotEvent {
  return {
    type: 'debug.snapshot',
    status: {
      isOpen: true,
      url: 'https://example.com',
      title: 'Example Page',
      status: 'ready',
      viewport: { width: 1280, height: 720 },
    },
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.status event. */
export function mockDebugStatusEvent(overrides?: Partial<DebugStatusEvent>): DebugStatusEvent {
  return {
    type: 'debug.status',
    status: {
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
    },
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.error event. */
export function mockDebugErrorEvent(overrides?: Partial<DebugErrorEvent>): DebugErrorEvent {
  return {
    type: 'debug.error',
    code: 'upstream_disconnected',
    message: 'Browser connection lost',
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.marker event. */
export function mockDebugMarkerEvent(overrides?: Partial<DebugMarkerEvent>): DebugMarkerEvent {
  return {
    type: 'debug.marker',
    marker: {
      source: 'ai',
      action: 'click',
      pageX: 100,
      pageY: 200,
      bbox: { x: 90, y: 190, width: 20, height: 20 },
      selector: '#test-button',
      nebulaId: 1,
      ttlMs: 5000,
    },
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.overlay event. */
export function mockDebugOverlayEvent(overrides?: Partial<DebugOverlayEvent>): DebugOverlayEvent {
  return {
    type: 'debug.overlay',
    overlay: {
      kind: 'highlight',
      source: 'ai',
      bbox: { x: 10, y: 20, width: 100, height: 50 },
      ttlMs: 3000,
    },
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.mcp_invalidated event. */
export function mockDebugMcpInvalidatedEvent(overrides?: Partial<DebugMcpInvalidatedEvent>): DebugMcpInvalidatedEvent {
  return {
    type: 'debug.mcp_invalidated',
    scope: 'tools',
    reason: 'tool_call',
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock debug.keepalive event. */
export function mockDebugKeepaliveEvent(overrides?: Partial<DebugKeepaliveEvent>): DebugKeepaliveEvent {
  return {
    type: 'debug.keepalive',
    emittedAt: new Date().toISOString(),
    ...overrides,
  };
}

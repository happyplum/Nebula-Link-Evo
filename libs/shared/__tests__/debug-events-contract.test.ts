import { describe, it, expect } from 'vitest';
import type {
  DebugSnapshotEvent,
  DebugStatusEvent,
  DebugErrorEvent,
  DebugMarkerEvent,
  DebugOverlayEvent,
  DebugMcpInvalidatedEvent,
  DebugKeepaliveEvent,
  DebugStreamEvent,
} from '../types/debug-events.js';

describe('Debug Events Contract - JSON Decode Validation', () => {
  it('decodes debug.snapshot event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.snapshot',
      seq: 1,
      status: {
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
        status: 'ready',
        viewport: { width: 1280, height: 720 },
        reason: 'open',
      },
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugSnapshotEvent;

    expect(event.type).toBe('debug.snapshot');
    expect(event.seq).toBe(1);
    expect(event.status.isOpen).toBe(true);
    expect(event.status.url).toBe('https://example.com');
    expect(event.status.title).toBe('Example');
    expect(event.status.status).toBe('ready');
    expect(event.status.viewport?.width).toBe(1280);
    expect(event.status.viewport?.height).toBe(720);
    expect(event.status.reason).toBe('open');
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.status event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.status',
      seq: 2,
      status: {
        isOpen: false,
        url: null,
        title: null,
        status: 'unknown',
      },
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugStatusEvent;

    expect(event.type).toBe('debug.status');
    expect(event.seq).toBe(2);
    expect(event.status.isOpen).toBe(false);
    expect(event.status.url).toBeNull();
    expect(event.status.status).toBe('unknown');
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.error event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.error',
      seq: 3,
      code: 'upstream_disconnected',
      message: 'Browser connection lost',
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugErrorEvent;

    expect(event.type).toBe('debug.error');
    expect(event.seq).toBe(3);
    expect(event.code).toBe('upstream_disconnected');
    expect(event.message).toBe('Browser connection lost');
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.marker event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.marker',
      seq: 4,
      marker: {
        source: 'ai',
        action: 'click',
        pageX: 100,
        pageY: 200,
        bbox: { x: 90, y: 190, width: 20, height: 20 },
        selector: '#btn',
        nebulaId: 42,
        ttlMs: 5000,
      },
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugMarkerEvent;

    expect(event.type).toBe('debug.marker');
    expect(event.seq).toBe(4);
    expect(event.marker.source).toBe('ai');
    expect(event.marker.action).toBe('click');
    expect(event.marker.pageX).toBe(100);
    expect(event.marker.pageY).toBe(200);
    expect(event.marker.bbox?.x).toBe(90);
    expect(event.marker.selector).toBe('#btn');
    expect(event.marker.nebulaId).toBe(42);
    expect(event.marker.ttlMs).toBe(5000);
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.overlay event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.overlay',
      seq: 5,
      overlay: {
        kind: 'highlight',
        source: 'manual',
        bbox: { x: 10, y: 20, width: 100, height: 50 },
        ttlMs: 3000,
      },
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugOverlayEvent;

    expect(event.type).toBe('debug.overlay');
    expect(event.seq).toBe(5);
    expect(event.overlay?.kind).toBe('highlight');
    expect(event.overlay?.source).toBe('manual');
    expect(event.overlay?.bbox.x).toBe(10);
    expect(event.overlay?.ttlMs).toBe(3000);
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.mcp_invalidated event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.mcp_invalidated',
      seq: 6,
      scope: 'tools',
      reason: 'tool_call',
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugMcpInvalidatedEvent;

    expect(event.type).toBe('debug.mcp_invalidated');
    expect(event.seq).toBe(6);
    expect(event.scope).toBe('tools');
    expect(event.reason).toBe('tool_call');
    expect(typeof event.emittedAt).toBe('string');
  });

  it('decodes debug.keepalive event from JSON', () => {
    const json = JSON.stringify({
      type: 'debug.keepalive',
      seq: 7,
      emittedAt: new Date().toISOString(),
    });

    const event = JSON.parse(json) as DebugKeepaliveEvent;

    expect(event.type).toBe('debug.keepalive');
    expect(event.seq).toBe(7);
    expect(typeof event.emittedAt).toBe('string');
  });

  it('validates all 7 event variants in discriminated union', () => {
    const now = new Date().toISOString();
    const events: DebugStreamEvent[] = [
      {
        type: 'debug.snapshot',
        status: { isOpen: true, url: 'about:blank', title: null, status: 'ready' },
        emittedAt: now,
      },
      {
        type: 'debug.status',
        status: { isOpen: false, url: null, title: null, status: 'unknown' },
        emittedAt: now,
      },
      {
        type: 'debug.error',
        code: 'upstream_timeout',
        message: 'Timed out',
        emittedAt: now,
      },
      {
        type: 'debug.marker',
        marker: { source: 'ai', pageX: 0, pageY: 0 },
        emittedAt: now,
      },
      {
        type: 'debug.overlay',
        overlay: { kind: 'highlight', source: 'system', bbox: { x: 0, y: 0, width: 1, height: 1 } },
        emittedAt: now,
      },
      {
        type: 'debug.mcp_invalidated',
        scope: 'all',
        reason: 'startup',
        emittedAt: now,
      },
      {
        type: 'debug.keepalive',
        emittedAt: now,
      },
    ];

    expect(events).toHaveLength(7);
    events.forEach((event) => {
      expect(event).toBeDefined();
      expect(typeof event.type).toBe('string');
      expect(event.type).toMatch(/^debug\./);
    });
  });
});

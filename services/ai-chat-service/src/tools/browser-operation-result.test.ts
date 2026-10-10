import type { McpResult } from '@deepseek-ai/dsh-mcp-client';
import { describe, expect, it } from 'vitest';
import { readBrowserOperationResult } from './browser-operation-result.js';

function operationRecord() {
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId: 'operation-1',
    requestHash: 'hash',
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseSequence: 1,
    kind: 'observe',
    operation: 'dom_snapshot',
    status: 'succeeded',
    queueSequence: 1,
    acceptedAt: '2026-10-03T00:00:00.000Z',
    artifacts: [
      {
        id: 'dom-1',
        kind: 'dom_snapshot',
        sha256: 'a'.repeat(64),
        mimeType: 'application/json',
        sizeBytes: 123,
        snapshotId: 'snapshot-1',
      },
    ],
  };
}

describe('readBrowserOperationResult', () => {
  it('returns the canonical structured record unchanged and ignores contradictory text', () => {
    const operation = operationRecord();
    const result = {
      content: [{ type: 'text', text: '{"status":"failed"}' }],
      structuredContent: operation,
    };
    expect(readBrowserOperationResult(result)).toBe(operation);
  });

  it.each([undefined, null, [], 'record', { status: 'succeeded' }])(
    'rejects incomplete structuredContent %j even with a valid text record',
    (structuredContent) => {
      const result = {
        content: [{ type: 'text', text: JSON.stringify(operationRecord()) }],
        structuredContent,
      };
      expect(readBrowserOperationResult(result)).toBeNull();
    }
  );

  it.each([
    { queueSequence: '1' },
    { acceptedAt: 1 },
    { status: 'done' },
    { operation: 'unsupported' },
    { schema: 'legacy' },
    { leaseSequence: 1.5 },
    { artifacts: [{ id: 'incomplete' }] },
    { error: { code: 'failed' } },
    { resolvedTarget: { semantic: 'button' } },
    { visionSnapshotBinding: {} },
  ])('rejects malformed record fields %j', (fields) => {
    const result = { content: [], structuredContent: { ...operationRecord(), ...fields } };
    expect(readBrowserOperationResult(result as unknown as McpResult)).toBeNull();
  });

  it('allows non-DOM artifact references without a snapshotId', () => {
    const operation = {
      ...operationRecord(),
      operation: 'page_state',
      artifacts: [
        {
          id: 'image-1',
          kind: 'screenshot',
          sha256: 'b'.repeat(64),
          mimeType: 'image/png',
          sizeBytes: 42,
        },
      ],
    };
    expect(readBrowserOperationResult({ content: [], structuredContent: operation })).toBe(
      operation
    );
  });
});

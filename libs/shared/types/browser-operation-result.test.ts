import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { ACT_OPERATIONS, OBSERVE_OPERATIONS } from './browser-execution.js';
import {
  BROWSER_OPERATION_STATUSES,
  BrowserOperationRecordSchema,
  type BrowserOperationRecord,
} from './browser-operation-result.js';

function record(): BrowserOperationRecord {
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId: 'op-1',
    requestHash: 'hash-1',
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseSequence: 1,
    kind: 'observe',
    operation: 'url',
    status: 'succeeded',
    queueSequence: 1,
    acceptedAt: 'accepted',
    artifacts: [],
  };
}

function completeRecord(): BrowserOperationRecord {
  return {
    ...record(),
    tabId: 'tab-1',
    startedAt: 'started',
    completedAt: 'completed',
    resolvedTarget: { semantic: '', strategy: 'role', candidateIndex: 0, matchedCount: 0 },
    actual: { nested: [null, false, 1, 'value'] },
    artifacts: [
      {
        id: 'artifact-1',
        kind: 'dom_snapshot',
        sha256: 'a'.repeat(64),
        mimeType: 'application/json',
        sizeBytes: 1,
        snapshotId: 'snapshot-1',
      },
    ],
    error: {
      code: 'error',
      message: 'message',
      retryable: false,
      correlationId: 'correlation-1',
      details: { nested: { free: ['data'] } },
    },
  };
}

describe('Browser operation result contract', () => {
  it('accepts omitted optional fields and preserves the existing unformatted strings and integer bounds', () => {
    expect(Value.Check(BrowserOperationRecordSchema, record())).toBe(true);
    expect(Value.Check(BrowserOperationRecordSchema, completeRecord())).toBe(true);
    expect(
      Value.Check(BrowserOperationRecordSchema, {
        ...record(),
        leaseSequence: -1,
        queueSequence: -1,
        acceptedAt: '',
        actual: null,
      })
    ).toBe(true);
  });

  it('accepts the existing operation vocabulary and every operation status', () => {
    for (const [kind, operations] of [
      ['observe', OBSERVE_OPERATIONS],
      ['act', ACT_OPERATIONS],
    ] as const) {
      for (const operation of operations) {
        for (const status of BROWSER_OPERATION_STATUSES) {
          expect(
            Value.Check(BrowserOperationRecordSchema, { ...record(), kind, operation, status })
          ).toBe(true);
        }
      }
    }
  });

  it.each([
    'schema',
    'operationId',
    'requestHash',
    'sessionId',
    'leaseId',
    'leaseSequence',
    'kind',
    'operation',
    'status',
    'queueSequence',
    'acceptedAt',
    'artifacts',
  ])('requires %s', (field) => {
    const value: Record<string, unknown> = { ...record() };
    delete value[field];
    expect(Value.Check(BrowserOperationRecordSchema, value)).toBe(false);
  });

  it.each([
    { schema: 'nebula.browser.operation-result/2.0' },
    { kind: 'control' },
    { operation: 'unsupported' },
    { status: 'done' },
    { leaseSequence: 0.5 },
    { queueSequence: 0.5 },
    { acceptedAt: 123 },
    { artifacts: null },
    { tabId: null },
    { startedAt: 123 },
    { completedAt: null },
    { unexpected: true },
  ])('rejects invalid top-level fields: %j', (fields) => {
    expect(Value.Check(BrowserOperationRecordSchema, { ...record(), ...fields })).toBe(false);
  });

  it.each([
    { candidateIndex: -1 },
    { candidateIndex: 0.5 },
    { matchedCount: -1 },
    { matchedCount: 0.5 },
    { strategy: 'coordinates' },
    { unexpected: true },
  ])('rejects invalid resolved targets: %j', (fields) => {
    const value = completeRecord();
    expect(
      Value.Check(BrowserOperationRecordSchema, {
        ...value,
        resolvedTarget: { ...value.resolvedTarget, ...fields },
      })
    ).toBe(false);
  });

  it.each([
    { sha256: 'A'.repeat(64) },
    { sha256: 'a'.repeat(63) },
    { sizeBytes: 0 },
    { sizeBytes: 1.5 },
    { snapshotId: '' },
    { snapshotId: null },
    { mimeType: 123 },
    { unexpected: true },
  ])('rejects invalid artifacts: %j', (fields) => {
    const value = completeRecord();
    expect(
      Value.Check(BrowserOperationRecordSchema, {
        ...value,
        artifacts: [{ ...value.artifacts[0], ...fields }],
      })
    ).toBe(false);
  });

  it.each([
    { code: 123 },
    { message: false },
    { retryable: 'false' },
    { correlationId: null },
    { details: [] },
    { details: null },
    { unexpected: true },
  ])('rejects invalid problems: %j', (fields) => {
    const value = completeRecord();
    expect(
      Value.Check(BrowserOperationRecordSchema, {
        ...value,
        error: { ...value.error, ...fields },
      })
    ).toBe(false);
  });

  it('requires nested fields while keeping snapshotId and details optional', () => {
    const value = completeRecord();
    for (const [object, fields] of [
      [value.artifacts[0], ['id', 'kind', 'sha256', 'mimeType', 'sizeBytes']],
      [value.resolvedTarget, ['semantic', 'strategy', 'candidateIndex', 'matchedCount']],
      [value.error, ['code', 'message', 'retryable', 'correlationId']],
    ] as const) {
      for (const field of fields) {
        const candidate = structuredClone(value);
        const nested =
          object === value.artifacts[0]
            ? candidate.artifacts[0]
            : object === value.resolvedTarget
              ? candidate.resolvedTarget
              : candidate.error;
        delete (nested as Record<string, unknown>)[field];
        expect(Value.Check(BrowserOperationRecordSchema, candidate)).toBe(false);
      }
    }
    delete value.artifacts[0].snapshotId;
    delete value.error?.details;
    expect(Value.Check(BrowserOperationRecordSchema, value)).toBe(true);
  });
});

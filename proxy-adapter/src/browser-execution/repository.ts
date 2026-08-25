import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BrowserExecutionError } from './errors.js';
import type {
  BrowserExecutionProblem,
  BrowserArtifactHoldRecord,
  BrowserArtifactRecord,
  BrowserCaptureRecord,
  BrowserLeaseRecord,
  BrowserOperationRecord,
  BrowserOperationRequestV1,
  BrowserOperationStatus,
  BrowserSessionRecord,
  BrowserSessionEventRecord,
} from './types.js';

interface SessionRow {
  id: string;
  status: BrowserSessionRecord['status'];
  process_epoch: number;
  viewport_json: string;
  cdp_port: number;
  created_at: string;
  activated_at: string | null;
  closed_at: string | null;
  failure_json: string | null;
}

interface LeaseRow {
  id: string;
  session_id: string;
  mode: BrowserLeaseRecord['mode'];
  sequence: number;
  process_epoch: number;
  status: BrowserLeaseRecord['status'];
  policy_json: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

interface OperationRow {
  id: string;
  request_hash: string;
  session_id: string;
  lease_id: string;
  lease_sequence: number;
  tab_id: string | null;
  kind: BrowserOperationRecord['kind'];
  operation: BrowserOperationRecord['operation'];
  request_json: string;
  status: BrowserOperationStatus;
  queue_sequence: number;
  accepted_at: string;
  started_at: string | null;
  completed_at: string | null;
  resolved_target_json: string | null;
  actual_json: string | null;
  artifacts_json: string;
  error_json: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  resource_type: string;
  resource_id: string;
}

interface CaptureRow {
  id: string;
  operation_id: string;
  session_id: string;
  tab_id: string | null;
  request_hash: string;
  requested_json: string;
  status: BrowserCaptureRecord['status'];
  completeness: BrowserCaptureRecord['completeness'];
  expected_item_count: number;
  actual_item_count: number;
  created_at: string;
  completed_at: string | null;
  error_json: string | null;
}

interface ArtifactRow {
  id: string;
  session_id: string;
  operation_id: string | null;
  capture_id: string | null;
  tab_id: string | null;
  kind: BrowserArtifactRecord['kind'];
  capture_phase: BrowserArtifactRecord['capturePhase'];
  status: BrowserArtifactRecord['status'];
  completeness: BrowserArtifactRecord['completeness'];
  mime_type: string;
  sha256: string | null;
  size_bytes: number | null;
  storage_backend: BrowserArtifactRecord['storageBackend'];
  storage_ref: string | null;
  redaction_status: BrowserArtifactRecord['redactionStatus'];
  retention_class: BrowserArtifactRecord['retentionClass'];
  expires_at: string | null;
  created_at: string;
  available_at: string | null;
  deleted_at: string | null;
  error_json: string | null;
}

interface ArtifactHoldRow {
  id: string;
  artifact_id: string;
  owner_service: string;
  owner_ref: string;
  request_hash: string;
  created_at: string;
  expires_at: string | null;
  released_at: string | null;
}

interface SessionEventRow {
  id: string;
  session_id: string;
  seq: number;
  type: string;
  entity_type: BrowserSessionEventRecord['entityType'];
  entity_id: string;
  state_version: number | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload_json: string;
  occurred_at: string;
  created_at: string;
}

export interface StoredIdempotencyRecord {
  requestHash: string;
  resourceType: string;
  resourceId: string;
}

export interface BrowserLedgerCleanupResult {
  operationsDeleted: number;
  idempotencyDeleted: number;
}

export interface CreateOperationRecord {
  requestHash: string;
  input: {
    sessionId: string;
    leaseId: string;
    tabId?: string;
    request: BrowserOperationRequestV1;
  };
  acceptedAt: string;
}

export interface CreateBrowserCaptureRecord {
  id: string;
  operationId: string;
  requestHash: string;
  requested: NonNullable<BrowserOperationRequestV1['capture']>;
  expectedItemCount: number;
  createdAt: string;
}

export interface AppendBrowserSessionEvent {
  id: string;
  sessionId: string;
  type: string;
  entityType: BrowserSessionEventRecord['entityType'];
  entityId: string;
  stateVersion?: number;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export class BrowserExecutionRepository {
  private db: DatabaseSync | null = null;
  private transactionDepth = 0;

  constructor(private readonly dbPath: string) {}

  initialize(): number {
    if (!this.db) {
      if (this.dbPath !== ':memory:') {
        mkdirSync(dirname(this.dbPath), { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec('PRAGMA synchronous = FULL');
      this.db.exec('PRAGMA busy_timeout = 5000');
      this.db.exec('PRAGMA foreign_keys = ON');
      this.createSchema();
    }

    return this.transaction(() => {
      const row = this.requireDb()
        .prepare("SELECT value FROM browser_execution_meta WHERE key = 'process_epoch'")
        .get() as { value: string } | undefined;
      const nextEpoch = Number.parseInt(row?.value ?? '0', 10) + 1;
      this.requireDb()
        .prepare(
          `INSERT INTO browser_execution_meta (key, value)
           VALUES ('process_epoch', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(String(nextEpoch));
      return nextEpoch;
    });
  }

  recoverAfterRestart(now: string): void {
    this.transaction(() => {
      const problem: BrowserExecutionProblem = {
        code: 'outcome_unknown',
        message:
          'Proxy restarted after the browser operation started; the side effect outcome is unknown',
        retryable: false,
        correlationId: 'recovery',
      };
      this.requireDb()
        .prepare(
          `UPDATE browser_operations
           SET status = 'outcome_unknown', completed_at = ?, error_json = ?
           WHERE status = 'running'`
        )
        .run(now, JSON.stringify(problem));

      const cancelledProblem: BrowserExecutionProblem = {
        code: 'lease_expired',
        message: 'Proxy restarted before the queued browser operation started',
        retryable: false,
        correlationId: 'recovery',
      };
      this.requireDb()
        .prepare(
          `UPDATE browser_operations
           SET status = 'cancelled', completed_at = ?, error_json = ?
           WHERE status = 'queued'`
        )
        .run(now, JSON.stringify(cancelledProblem));

      this.requireDb()
        .prepare(
          `UPDATE browser_leases
           SET status = 'expired', revoked_at = ?
           WHERE status = 'active'`
        )
        .run(now);
      this.requireDb()
        .prepare(
          `UPDATE browser_sessions
           SET status = 'interrupted', closed_at = ?
           WHERE status IN ('opening', 'active')`
        )
        .run(now);
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  findIdempotency(scope: string, key: string): StoredIdempotencyRecord | undefined {
    const row = this.requireDb()
      .prepare(
        `SELECT request_hash, resource_type, resource_id
         FROM browser_idempotency WHERE scope = ? AND key = ?`
      )
      .get(scope, key) as IdempotencyRow | undefined;
    return row
      ? {
          requestHash: row.request_hash,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
        }
      : undefined;
  }

  insertIdempotency(
    scope: string,
    key: string,
    requestHash: string,
    resourceType: string,
    resourceId: string,
    createdAt: string
  ): void {
    this.requireDb()
      .prepare(
        `INSERT INTO browser_idempotency (
          scope, key, request_hash, resource_type, resource_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(scope, key, requestHash, resourceType, resourceId, createdAt);
  }

  findActiveSession(): BrowserSessionRecord | undefined {
    const row = this.requireDb()
      .prepare(
        `SELECT * FROM browser_sessions
         WHERE status IN ('opening', 'active')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get() as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  insertSession(session: BrowserSessionRecord): void {
    this.requireDb()
      .prepare(
        `INSERT INTO browser_sessions (
          id, status, process_epoch, viewport_json, cdp_port, created_at,
          activated_at, closed_at, failure_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.status,
        session.processEpoch,
        JSON.stringify(session.viewport),
        session.cdpPort,
        session.createdAt,
        session.activatedAt ?? null,
        session.closedAt ?? null,
        session.failure ? JSON.stringify(session.failure) : null
      );
  }

  getSession(id: string): BrowserSessionRecord | undefined {
    const row = this.requireDb().prepare('SELECT * FROM browser_sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  updateSessionStatus(
    id: string,
    status: BrowserSessionRecord['status'],
    fields: {
      activatedAt?: string;
      closedAt?: string;
      failure?: BrowserExecutionProblem;
    } = {}
  ): void {
    this.requireDb()
      .prepare(
        `UPDATE browser_sessions
         SET status = ?,
             activated_at = COALESCE(?, activated_at),
             closed_at = COALESCE(?, closed_at),
             failure_json = COALESCE(?, failure_json)
         WHERE id = ?`
      )
      .run(
        status,
        fields.activatedAt ?? null,
        fields.closedAt ?? null,
        fields.failure ? JSON.stringify(fields.failure) : null,
        id
      );
  }

  getLease(id: string): BrowserLeaseRecord | undefined {
    const row = this.requireDb().prepare('SELECT * FROM browser_leases WHERE id = ?').get(id) as
      | LeaseRow
      | undefined;
    return row ? mapLease(row) : undefined;
  }

  listActiveLeases(sessionId: string, now: string): BrowserLeaseRecord[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT * FROM browser_leases
         WHERE session_id = ? AND status = 'active' AND expires_at > ?
         ORDER BY sequence ASC`
      )
      .all(sessionId, now) as unknown as LeaseRow[];
    return rows.map(mapLease);
  }

  expireLeases(now: string): void {
    this.requireDb()
      .prepare(
        `UPDATE browser_leases
         SET status = 'expired', revoked_at = ?
         WHERE status = 'active' AND expires_at <= ?`
      )
      .run(now, now);
  }

  nextLeaseSequence(sessionId: string): number {
    const row = this.requireDb()
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM browser_leases WHERE session_id = ?'
      )
      .get(sessionId) as { sequence: number };
    return row.sequence + 1;
  }

  insertLease(lease: BrowserLeaseRecord): void {
    this.requireDb()
      .prepare(
        `INSERT INTO browser_leases (
          id, session_id, mode, sequence, process_epoch, status, policy_json,
          token_hash, expires_at, created_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        lease.id,
        lease.sessionId,
        lease.mode,
        lease.sequence,
        lease.processEpoch,
        lease.status,
        JSON.stringify(lease.policy),
        lease.tokenHash,
        lease.expiresAt,
        lease.createdAt,
        lease.revokedAt ?? null
      );
  }

  revokeLease(id: string, revokedAt: string): void {
    this.requireDb()
      .prepare(
        `UPDATE browser_leases SET status = 'revoked', revoked_at = ?
         WHERE id = ? AND status = 'active'`
      )
      .run(revokedAt, id);
  }

  closeSessionResources(sessionId: string, closedAt: string): void {
    this.requireDb()
      .prepare(
        `UPDATE browser_leases
         SET status = 'revoked', revoked_at = ?
         WHERE session_id = ? AND status = 'active'`
      )
      .run(closedAt, sessionId);

    const problem: BrowserExecutionProblem = {
      code: 'state_conflict',
      message: 'Browser session closed before the queued operation started',
      retryable: false,
      correlationId: sessionId,
    };
    this.requireDb()
      .prepare(
        `UPDATE browser_operations
         SET status = 'cancelled', completed_at = ?, error_json = ?
         WHERE session_id = ? AND status = 'queued'`
      )
      .run(closedAt, JSON.stringify(problem), sessionId);

    this.updateSessionStatus(sessionId, 'closed', { closedAt });
  }

  interruptActiveSession(closedAt: string, problem: BrowserExecutionProblem): void {
    this.transaction(() => {
      const active = this.findActiveSession();
      if (!active) {
        return;
      }
      this.requireDb()
        .prepare(
          `UPDATE browser_leases
           SET status = 'revoked', revoked_at = ?
           WHERE session_id = ? AND status = 'active'`
        )
        .run(closedAt, active.id);
      this.requireDb()
        .prepare(
          `UPDATE browser_operations
           SET status = 'cancelled', completed_at = ?, error_json = ?
           WHERE session_id = ? AND status = 'queued'`
        )
        .run(closedAt, JSON.stringify(problem), active.id);
      this.updateSessionStatus(active.id, 'interrupted', {
        closedAt,
        failure: problem,
      });
    });
  }

  insertOperation(record: CreateOperationRecord): BrowserOperationRecord {
    return this.transaction(() => {
      const sequenceRow = this.requireDb()
        .prepare('SELECT COALESCE(MAX(queue_sequence), 0) AS sequence FROM browser_operations')
        .get() as { sequence: number };
      const queueSequence = sequenceRow.sequence + 1;
      this.requireDb()
        .prepare(
          `INSERT INTO browser_operations (
            id, request_hash, session_id, lease_id, lease_sequence, tab_id,
            kind, operation, request_json, status, queue_sequence, accepted_at,
            artifacts_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, '[]')`
        )
        .run(
          record.input.request.operationId,
          record.requestHash,
          record.input.sessionId,
          record.input.leaseId,
          record.input.request.leaseSequence,
          record.input.tabId ?? null,
          record.input.request.kind,
          record.input.request.operation,
          JSON.stringify(redactOperationRequest(record.input.request)),
          queueSequence,
          record.acceptedAt
        );
      return this.getOperationOrThrow(record.input.request.operationId);
    });
  }

  getOperation(id: string): BrowserOperationRecord | undefined {
    const row = this.requireDb()
      .prepare('SELECT * FROM browser_operations WHERE id = ?')
      .get(id) as OperationRow | undefined;
    return row ? mapOperation(row) : undefined;
  }

  markOperationRunning(id: string, startedAt: string): BrowserOperationRecord {
    const result = this.requireDb()
      .prepare(
        `UPDATE browser_operations SET status = 'running', started_at = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(startedAt, id);
    if (result.changes !== 1) {
      return this.getOperationOrThrow(id);
    }
    return this.getOperationOrThrow(id);
  }

  completeOperation(
    id: string,
    status: Extract<
      BrowserOperationStatus,
      'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown'
    >,
    completedAt: string,
    fields: {
      actual?: unknown;
      resolvedTarget?: BrowserOperationRecord['resolvedTarget'];
      artifacts?: BrowserOperationRecord['artifacts'];
      error?: BrowserExecutionProblem;
    } = {}
  ): BrowserOperationRecord {
    this.requireDb()
      .prepare(
        `UPDATE browser_operations
         SET status = ?, completed_at = ?, actual_json = ?, resolved_target_json = ?,
             artifacts_json = ?, error_json = ?
         WHERE id = ?`
      )
      .run(
        status,
        completedAt,
        fields.actual === undefined ? null : JSON.stringify(fields.actual),
        fields.resolvedTarget ? JSON.stringify(fields.resolvedTarget) : null,
        JSON.stringify(fields.artifacts ?? []),
        fields.error ? JSON.stringify(fields.error) : null,
        id
      );
    return this.getOperationOrThrow(id);
  }

  cancelQueuedOperation(
    id: string,
    completedAt: string,
    error: BrowserExecutionProblem
  ): BrowserOperationRecord {
    const result = this.requireDb()
      .prepare(
        `UPDATE browser_operations
         SET status = 'cancelled', completed_at = ?, error_json = ?
         WHERE id = ? AND status = 'queued'`
      )
      .run(completedAt, JSON.stringify(error), id);
    if (result.changes !== 1) {
      return this.getOperationOrThrow(id);
    }
    return this.getOperationOrThrow(id);
  }

  createCapture(input: CreateBrowserCaptureRecord): BrowserCaptureRecord {
    assertSha256(input.requestHash, 'capture requestHash');
    if (!Number.isSafeInteger(input.expectedItemCount) || input.expectedItemCount < 1) {
      throw new BrowserExecutionError(
        'validation_failed',
        'Capture expectedItemCount must be a positive integer'
      );
    }
    const operation = this.getOperationOrThrow(input.operationId);
    this.requireDb()
      .prepare(
        `INSERT INTO browser_operation_captures (
          id, operation_id, session_id, tab_id, request_hash, requested_json, status,
          completeness, expected_item_count, actual_item_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 'partial', ?, 0, ?)`
      )
      .run(
        input.id,
        operation.operationId,
        operation.sessionId,
        operation.tabId ?? null,
        input.requestHash,
        JSON.stringify(input.requested),
        input.expectedItemCount,
        input.createdAt
      );
    return this.getCaptureOrThrow(input.id);
  }

  completeCapture(
    id: string,
    input: {
      status: Extract<BrowserCaptureRecord['status'], 'completed' | 'failed'>;
      completeness: BrowserCaptureRecord['completeness'];
      actualItemCount: number;
      completedAt: string;
      error?: BrowserExecutionProblem;
    }
  ): BrowserCaptureRecord {
    if (!Number.isSafeInteger(input.actualItemCount) || input.actualItemCount < 0) {
      throw new BrowserExecutionError(
        'validation_failed',
        'Capture actualItemCount must be a non-negative integer'
      );
    }
    const result = this.requireDb()
      .prepare(
        `UPDATE browser_operation_captures
         SET status = ?, completeness = ?, actual_item_count = ?, completed_at = ?, error_json = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(
        input.status,
        input.completeness,
        input.actualItemCount,
        input.completedAt,
        input.error ? JSON.stringify(input.error) : null,
        id
      );
    if (result.changes !== 1) {
      throw new BrowserExecutionError('state_conflict', `Capture ${id} is not pending`);
    }
    return this.getCaptureOrThrow(id);
  }

  getCapture(id: string): BrowserCaptureRecord | undefined {
    const row = this.requireDb()
      .prepare('SELECT * FROM browser_operation_captures WHERE id = ?')
      .get(id) as CaptureRow | undefined;
    return row ? mapCapture(row) : undefined;
  }

  insertArtifact(artifact: BrowserArtifactRecord): BrowserArtifactRecord {
    if (artifact.status === 'available') {
      assertSha256(artifact.sha256, 'artifact sha256');
      if (!Number.isSafeInteger(artifact.sizeBytes) || (artifact.sizeBytes ?? -1) < 0) {
        throw new BrowserExecutionError(
          'validation_failed',
          'Available artifact sizeBytes must be a non-negative integer'
        );
      }
      if (!artifact.storageRef) {
        throw new BrowserExecutionError(
          'validation_failed',
          'Available artifact storageRef is required'
        );
      }
    }
    this.requireDb()
      .prepare(
        `INSERT INTO browser_artifacts (
          id, session_id, operation_id, capture_id, tab_id, kind, capture_phase, status,
          completeness, mime_type, sha256, size_bytes, storage_backend, storage_ref,
          redaction_status, retention_class, expires_at, created_at, available_at, deleted_at,
          error_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifact.id,
        artifact.sessionId,
        artifact.operationId ?? null,
        artifact.captureId ?? null,
        artifact.tabId ?? null,
        artifact.kind,
        artifact.capturePhase,
        artifact.status,
        artifact.completeness,
        artifact.mimeType,
        artifact.sha256 ?? null,
        artifact.sizeBytes ?? null,
        artifact.storageBackend,
        artifact.storageRef ?? null,
        artifact.redactionStatus,
        artifact.retentionClass,
        artifact.expiresAt ?? null,
        artifact.createdAt,
        artifact.availableAt ?? null,
        artifact.deletedAt ?? null,
        artifact.error ? JSON.stringify(artifact.error) : null
      );
    return this.getArtifactOrThrow(artifact.id);
  }

  getArtifact(id: string): BrowserArtifactRecord | undefined {
    const row = this.requireDb().prepare('SELECT * FROM browser_artifacts WHERE id = ?').get(id) as
      | ArtifactRow
      | undefined;
    return row ? mapArtifact(row) : undefined;
  }

  listOperationArtifacts(operationId: string): BrowserArtifactRecord[] {
    const rows = this.requireDb()
      .prepare('SELECT * FROM browser_artifacts WHERE operation_id = ? ORDER BY created_at, id')
      .all(operationId) as unknown as ArtifactRow[];
    return rows.map(mapArtifact);
  }

  createArtifactHold(hold: BrowserArtifactHoldRecord): BrowserArtifactHoldRecord {
    assertSha256(hold.requestHash, 'artifact hold requestHash');
    const existing = this.requireDb()
      .prepare(
        `SELECT * FROM browser_artifact_holds
         WHERE artifact_id = ? AND owner_service = ? AND owner_ref = ?`
      )
      .get(hold.artifactId, hold.ownerService, hold.ownerRef) as ArtifactHoldRow | undefined;
    if (existing) {
      if (existing.request_hash !== hold.requestHash) {
        throw new BrowserExecutionError(
          'idempotency_conflict',
          'Artifact hold was replayed with a different request'
        );
      }
      return mapArtifactHold(existing);
    }
    this.requireDb()
      .prepare(
        `INSERT INTO browser_artifact_holds (
          id, artifact_id, owner_service, owner_ref, request_hash, created_at, expires_at,
          released_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hold.id,
        hold.artifactId,
        hold.ownerService,
        hold.ownerRef,
        hold.requestHash,
        hold.createdAt,
        hold.expiresAt ?? null,
        hold.releasedAt ?? null
      );
    return hold;
  }

  releaseArtifactHold(id: string, releasedAt: string): BrowserArtifactHoldRecord {
    this.requireDb()
      .prepare(
        `UPDATE browser_artifact_holds SET released_at = COALESCE(released_at, ?) WHERE id = ?`
      )
      .run(releasedAt, id);
    const row = this.requireDb()
      .prepare('SELECT * FROM browser_artifact_holds WHERE id = ?')
      .get(id) as ArtifactHoldRow | undefined;
    if (!row) throw new BrowserExecutionError('not_found', `Artifact hold ${id} was not found`);
    return mapArtifactHold(row);
  }

  listArtifactsEligibleForDeletion(now: string): BrowserArtifactRecord[] {
    const rows = this.requireDb()
      .prepare(
        `SELECT artifact.* FROM browser_artifacts artifact
         WHERE artifact.status IN ('available','failed','expired')
           AND artifact.expires_at IS NOT NULL AND artifact.expires_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM browser_artifact_holds hold
             WHERE hold.artifact_id = artifact.id AND hold.released_at IS NULL
               AND (hold.expires_at IS NULL OR hold.expires_at > ?)
           )
         ORDER BY artifact.expires_at, artifact.id`
      )
      .all(now, now) as unknown as ArtifactRow[];
    return rows.map(mapArtifact);
  }

  claimArtifactDeletion(id: string): BrowserArtifactRecord {
    const result = this.requireDb()
      .prepare(
        `UPDATE browser_artifacts SET status = 'expired'
         WHERE id = ? AND status IN ('available','failed','expired')`
      )
      .run(id);
    if (result.changes !== 1) {
      throw new BrowserExecutionError('state_conflict', `Artifact ${id} cannot be deleted`);
    }
    return this.getArtifactOrThrow(id);
  }

  hasOtherArtifactStorageReference(storageRef: string, artifactId: string): boolean {
    const row = this.requireDb()
      .prepare(
        `SELECT 1 AS found FROM browser_artifacts
         WHERE storage_ref = ? AND id <> ? AND status <> 'deleted'
         LIMIT 1`
      )
      .get(storageRef, artifactId) as { found: number } | undefined;
    return Boolean(row);
  }

  markArtifactDeleted(id: string, deletedAt: string): BrowserArtifactRecord {
    const result = this.requireDb()
      .prepare(
        `UPDATE browser_artifacts SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?)
         WHERE id = ? AND status = 'expired'`
      )
      .run(deletedAt, id);
    if (result.changes !== 1) {
      throw new BrowserExecutionError('state_conflict', `Artifact ${id} is not expired`);
    }
    return this.getArtifactOrThrow(id);
  }

  cleanupExpiredLedger(
    now: string,
    terminalCutoff: string
  ): BrowserLedgerCleanupResult {
    return this.transaction(() => {
      const operationIds = (
        this.requireDb()
          .prepare(
            `SELECT operation.id
             FROM browser_operations AS operation
             JOIN browser_sessions AS session ON session.id = operation.session_id
             WHERE operation.status IN ('succeeded','failed','cancelled')
               AND operation.completed_at IS NOT NULL AND operation.completed_at <= ?
               AND session.status IN ('closed','interrupted','failed')
               AND NOT EXISTS (
                 SELECT 1 FROM browser_artifacts AS artifact
                 WHERE artifact.operation_id = operation.id AND artifact.status <> 'deleted'
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM browser_artifacts AS artifact
                 JOIN browser_artifact_holds AS hold ON hold.artifact_id = artifact.id
                 WHERE artifact.operation_id = operation.id
                   AND hold.released_at IS NULL
                   AND (hold.expires_at IS NULL OR hold.expires_at > ?)
               )
             ORDER BY operation.completed_at, operation.id
             LIMIT 500`
          )
          .all(terminalCutoff, now) as unknown as Array<{ id: string }>
      ).map((row) => row.id);

      for (const operationId of operationIds) {
        this.requireDb()
          .prepare(
            `DELETE FROM browser_artifact_holds
             WHERE artifact_id IN (
               SELECT id FROM browser_artifacts WHERE operation_id = ?
             )`
          )
          .run(operationId);
        this.requireDb()
          .prepare('DELETE FROM browser_artifacts WHERE operation_id = ?')
          .run(operationId);
        this.requireDb()
          .prepare('DELETE FROM browser_operation_captures WHERE operation_id = ?')
          .run(operationId);
        this.requireDb().prepare('DELETE FROM browser_operations WHERE id = ?').run(operationId);
      }

      const idempotencyResult = this.requireDb()
        .prepare(
          `DELETE FROM browser_idempotency
           WHERE rowid IN (
             SELECT idempotency.rowid
             FROM browser_idempotency AS idempotency
             WHERE idempotency.created_at <= ?
               AND (
                 (
                   idempotency.resource_type = 'session'
                   AND EXISTS (
                     SELECT 1 FROM browser_sessions AS session
                     WHERE session.id = idempotency.resource_id
                       AND session.status IN ('closed','interrupted','failed')
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM browser_operations AS operation
                     WHERE operation.session_id = idempotency.resource_id
                       AND operation.status IN ('queued','running','outcome_unknown')
                   )
                 )
                 OR (
                   idempotency.resource_type = 'lease'
                   AND EXISTS (
                     SELECT 1 FROM browser_leases AS lease
                     WHERE lease.id = idempotency.resource_id
                       AND lease.status IN ('revoked','expired')
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM browser_operations AS operation
                     WHERE operation.lease_id = idempotency.resource_id
                       AND operation.status IN ('queued','running','outcome_unknown')
                   )
                 )
               )
             ORDER BY idempotency.created_at, idempotency.scope, idempotency.key
             LIMIT 1000
           )`
        )
        .run(terminalCutoff);

      return {
        operationsDeleted: operationIds.length,
        idempotencyDeleted: Number(idempotencyResult.changes),
      };
    });
  }

  appendSessionEvent(input: AppendBrowserSessionEvent): BrowserSessionEventRecord {
    assertSafeEventPayload(input.payload);
    return this.transaction(() => {
      this.requireDb()
        .prepare(
          `INSERT INTO browser_session_event_cursors (session_id, next_seq)
           VALUES (?, 1) ON CONFLICT(session_id) DO NOTHING`
        )
        .run(input.sessionId);
      const cursor = this.requireDb()
        .prepare(
          `UPDATE browser_session_event_cursors
           SET next_seq = next_seq + 1 WHERE session_id = ? RETURNING next_seq - 1 AS seq`
        )
        .get(input.sessionId) as { seq: number };
      const createdAt = new Date().toISOString();
      this.requireDb()
        .prepare(
          `INSERT INTO browser_session_events (
            id, session_id, seq, type, entity_type, entity_id, state_version,
            correlation_id, causation_id, payload_json, occurred_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.sessionId,
          cursor.seq,
          input.type,
          input.entityType,
          input.entityId,
          input.stateVersion ?? null,
          input.correlationId ?? null,
          input.causationId ?? null,
          JSON.stringify(input.payload),
          input.occurredAt,
          createdAt
        );
      const event = this.getSessionEvent(input.sessionId, cursor.seq);
      if (!event) {
        throw new Error(`Browser session event ${input.sessionId}:${cursor.seq} was not persisted`);
      }
      return event;
    });
  }

  listSessionEvents(sessionId: string, afterSeq = 0, limit = 100): BrowserSessionEventRecord[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 1000);
    const rows = this.requireDb()
      .prepare(
        `SELECT * FROM browser_session_events
         WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?`
      )
      .all(sessionId, afterSeq, boundedLimit) as unknown as SessionEventRow[];
    return rows.map(mapSessionEvent);
  }

  getLastSessionEventSeq(sessionId: string): number {
    const row = this.requireDb()
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) AS seq FROM browser_session_events WHERE session_id = ?'
      )
      .get(sessionId) as { seq: number };
    return row.seq;
  }

  transaction<T>(callback: () => T): T {
    if (this.transactionDepth > 0) {
      return callback();
    }
    const db = this.requireDb();
    db.exec('BEGIN IMMEDIATE');
    this.transactionDepth += 1;
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private getOperationOrThrow(id: string): BrowserOperationRecord {
    const operation = this.getOperation(id);
    if (!operation) {
      throw new BrowserExecutionError('not_found', `Browser operation ${id} was not found`);
    }
    return operation;
  }

  private getCaptureOrThrow(id: string): BrowserCaptureRecord {
    const capture = this.getCapture(id);
    if (!capture) throw new BrowserExecutionError('not_found', `Capture ${id} was not found`);
    return capture;
  }

  private getArtifactOrThrow(id: string): BrowserArtifactRecord {
    const artifact = this.getArtifact(id);
    if (!artifact) throw new BrowserExecutionError('not_found', `Artifact ${id} was not found`);
    return artifact;
  }

  private getSessionEvent(sessionId: string, seq: number): BrowserSessionEventRecord | undefined {
    const row = this.requireDb()
      .prepare('SELECT * FROM browser_session_events WHERE session_id = ? AND seq = ?')
      .get(sessionId, seq) as SessionEventRow | undefined;
    return row ? mapSessionEvent(row) : undefined;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Browser execution repository is not initialized');
    }
    return this.db;
  }

  private createSchema(): void {
    this.requireDb().exec(`
      CREATE TABLE IF NOT EXISTS browser_execution_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL CHECK(length(checksum) = 64),
        applied_at TEXT NOT NULL
      );
    `);
    this.applyMigration(
      1,
      'browser-execution-ledger',
      `
      CREATE TABLE IF NOT EXISTS browser_execution_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS browser_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        process_epoch INTEGER NOT NULL,
        viewport_json TEXT NOT NULL,
        cdp_port INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        closed_at TEXT,
        failure_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_sessions_single_active
        ON browser_sessions ((1)) WHERE status IN ('opening', 'active');

      CREATE TABLE IF NOT EXISTS browser_leases (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id),
        mode TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        process_epoch INTEGER NOT NULL,
        status TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        UNIQUE(session_id, sequence)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_leases_single_control
        ON browser_leases ((1)) WHERE mode = 'control' AND status = 'active';
      CREATE INDEX IF NOT EXISTS idx_browser_leases_session
        ON browser_leases (session_id, status, expires_at);

      CREATE TABLE IF NOT EXISTS browser_operations (
        id TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id),
        lease_id TEXT NOT NULL REFERENCES browser_leases(id),
        lease_sequence INTEGER NOT NULL,
        tab_id TEXT,
        kind TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_json TEXT NOT NULL,
        status TEXT NOT NULL,
        queue_sequence INTEGER NOT NULL UNIQUE,
        accepted_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        resolved_target_json TEXT,
        actual_json TEXT,
        artifacts_json TEXT NOT NULL,
        error_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_browser_operations_session_queue
        ON browser_operations (session_id, queue_sequence);
      CREATE INDEX IF NOT EXISTS idx_browser_operations_status
        ON browser_operations (status);

      CREATE TABLE IF NOT EXISTS browser_idempotency (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, key)
      );
    `
    );
    this.applyMigration(
      2,
      'browser-artifact-event-foundation',
      `
      CREATE TABLE IF NOT EXISTS browser_operation_captures (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE REFERENCES browser_operations(id) ON DELETE RESTRICT,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE RESTRICT,
        tab_id TEXT,
        request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
        requested_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
        completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','failed')),
        expected_item_count INTEGER NOT NULL CHECK(expected_item_count > 0),
        actual_item_count INTEGER NOT NULL DEFAULT 0 CHECK(actual_item_count >= 0),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_json TEXT
      );

      CREATE TABLE IF NOT EXISTS browser_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE RESTRICT,
        operation_id TEXT REFERENCES browser_operations(id) ON DELETE RESTRICT,
        capture_id TEXT REFERENCES browser_operation_captures(id) ON DELETE RESTRICT,
        tab_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('screenshot','dom_snapshot','video_segment','trace')),
        capture_phase TEXT NOT NULL CHECK(capture_phase IN ('before','after','failure','observation')),
        status TEXT NOT NULL CHECK(status IN ('pending','available','failed','expired','deleted')),
        completeness TEXT NOT NULL CHECK(completeness IN ('complete','partial','failed')),
        mime_type TEXT NOT NULL,
        sha256 TEXT CHECK(sha256 IS NULL OR length(sha256) = 64),
        size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
        storage_backend TEXT NOT NULL CHECK(storage_backend IN ('local_file','object_ref')),
        storage_ref TEXT,
        redaction_status TEXT NOT NULL CHECK(redaction_status IN ('not_required','pending','redacted','failed')),
        retention_class TEXT NOT NULL CHECK(retention_class IN ('volatile','success_7d','failure_30d','upstream_held')),
        expires_at TEXT,
        created_at TEXT NOT NULL,
        available_at TEXT,
        deleted_at TEXT,
        error_json TEXT,
        CHECK(status != 'available' OR (sha256 IS NOT NULL AND size_bytes IS NOT NULL AND storage_ref IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_browser_artifacts_operation
        ON browser_artifacts(operation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_browser_artifacts_retention
        ON browser_artifacts(status, expires_at);

      CREATE TABLE IF NOT EXISTS browser_artifact_holds (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL REFERENCES browser_artifacts(id) ON DELETE RESTRICT,
        owner_service TEXT NOT NULL,
        owner_ref TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK(length(request_hash) = 64),
        created_at TEXT NOT NULL,
        expires_at TEXT,
        released_at TEXT,
        UNIQUE(artifact_id, owner_service, owner_ref)
      );

      CREATE TABLE IF NOT EXISTS browser_session_event_cursors (
        session_id TEXT PRIMARY KEY REFERENCES browser_sessions(id) ON DELETE RESTRICT,
        next_seq INTEGER NOT NULL DEFAULT 1 CHECK(next_seq > 0)
      );
      CREATE TABLE IF NOT EXISTS browser_session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE RESTRICT,
        seq INTEGER NOT NULL CHECK(seq > 0),
        type TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('session','lease','operation','capture','artifact')),
        entity_id TEXT NOT NULL,
        state_version INTEGER CHECK(state_version IS NULL OR state_version > 0),
        correlation_id TEXT,
        causation_id TEXT,
        payload_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_browser_session_events_entity
        ON browser_session_events(session_id, entity_type, entity_id, seq);
    `
    );
  }

  private applyMigration(version: number, name: string, sql: string): void {
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = this.requireDb()
      .prepare('SELECT name, checksum FROM browser_execution_schema_migrations WHERE version = ?')
      .get(version) as { name: string; checksum: string } | undefined;
    if (existing) {
      if (existing.name !== name || existing.checksum !== checksum) {
        throw new Error(`Browser execution migration ${version} checksum mismatch`);
      }
      return;
    }
    this.transaction(() => {
      this.requireDb().exec(sql);
      this.requireDb()
        .prepare(
          `INSERT INTO browser_execution_schema_migrations (version, name, checksum, applied_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(version, name, checksum, new Date().toISOString());
    });
  }
}

function mapSession(row: SessionRow): BrowserSessionRecord {
  return {
    id: row.id,
    status: row.status,
    processEpoch: row.process_epoch,
    viewport: JSON.parse(row.viewport_json) as BrowserSessionRecord['viewport'],
    cdpPort: row.cdp_port,
    createdAt: row.created_at,
    ...(row.activated_at ? { activatedAt: row.activated_at } : {}),
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
    ...(row.failure_json
      ? { failure: JSON.parse(row.failure_json) as BrowserExecutionProblem }
      : {}),
  };
}

function mapLease(row: LeaseRow): BrowserLeaseRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    mode: row.mode,
    sequence: row.sequence,
    processEpoch: row.process_epoch,
    status: row.status,
    policy: JSON.parse(row.policy_json) as BrowserLeaseRecord['policy'],
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

function mapOperation(row: OperationRow): BrowserOperationRecord {
  return {
    schema: 'nebula.browser.operation-result/1.0',
    operationId: row.id,
    requestHash: row.request_hash,
    sessionId: row.session_id,
    leaseId: row.lease_id,
    leaseSequence: row.lease_sequence,
    ...(row.tab_id ? { tabId: row.tab_id } : {}),
    kind: row.kind,
    operation: row.operation,
    status: row.status,
    queueSequence: row.queue_sequence,
    acceptedAt: row.accepted_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.resolved_target_json
      ? {
          resolvedTarget: JSON.parse(
            row.resolved_target_json
          ) as BrowserOperationRecord['resolvedTarget'],
        }
      : {}),
    ...(row.actual_json ? { actual: JSON.parse(row.actual_json) as unknown } : {}),
    artifacts: JSON.parse(row.artifacts_json) as BrowserOperationRecord['artifacts'],
    ...(row.error_json ? { error: JSON.parse(row.error_json) as BrowserExecutionProblem } : {}),
  };
}

function mapCapture(row: CaptureRow): BrowserCaptureRecord {
  return {
    id: row.id,
    operationId: row.operation_id,
    sessionId: row.session_id,
    ...(row.tab_id ? { tabId: row.tab_id } : {}),
    requestHash: row.request_hash,
    requested: JSON.parse(row.requested_json) as BrowserCaptureRecord['requested'],
    status: row.status,
    completeness: row.completeness,
    expectedItemCount: row.expected_item_count,
    actualItemCount: row.actual_item_count,
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) as BrowserExecutionProblem } : {}),
  };
}

function mapArtifact(row: ArtifactRow): BrowserArtifactRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.operation_id ? { operationId: row.operation_id } : {}),
    ...(row.capture_id ? { captureId: row.capture_id } : {}),
    ...(row.tab_id ? { tabId: row.tab_id } : {}),
    kind: row.kind,
    capturePhase: row.capture_phase,
    status: row.status,
    completeness: row.completeness,
    mimeType: row.mime_type,
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    ...(row.size_bytes !== null ? { sizeBytes: row.size_bytes } : {}),
    storageBackend: row.storage_backend,
    ...(row.storage_ref ? { storageRef: row.storage_ref } : {}),
    redactionStatus: row.redaction_status,
    retentionClass: row.retention_class,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    createdAt: row.created_at,
    ...(row.available_at ? { availableAt: row.available_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.error_json ? { error: JSON.parse(row.error_json) as BrowserExecutionProblem } : {}),
  };
}

function mapArtifactHold(row: ArtifactHoldRow): BrowserArtifactHoldRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    ownerService: row.owner_service,
    ownerRef: row.owner_ref,
    requestHash: row.request_hash,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.released_at ? { releasedAt: row.released_at } : {}),
  };
}

function mapSessionEvent(row: SessionEventRow): BrowserSessionEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ...(row.state_version !== null ? { stateVersion: row.state_version } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function assertSha256(value: string | undefined, label: string): asserts value is string {
  if (!value || !/^[a-f0-9]{64}$/.test(value)) {
    throw new BrowserExecutionError('validation_failed', `${label} must be lowercase SHA-256`);
  }
}

function assertSafeEventPayload(payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    throw new BrowserExecutionError(
      'validation_failed',
      'Browser session event payload exceeds 256 KiB'
    );
  }
  assertNoInlineSecret(payload, 'payload');
}

function assertNoInlineSecret(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInlineSecret(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      /(?:password|token|authorization|cookie|api[_-]?key|secret)/i.test(key) &&
      !/(?:ref|refs|hash)$/i.test(key) &&
      child !== null &&
      child !== ''
    ) {
      throw new BrowserExecutionError(
        'validation_failed',
        `${path}.${key} must use an opaque reference or hash`
      );
    }
    assertNoInlineSecret(child, `${path}.${key}`);
  }
}

function redactOperationRequest(request: BrowserOperationRequestV1): Record<string, unknown> {
  return {
    schema: request.schema,
    operationId: request.operationId,
    leaseSequence: request.leaseSequence,
    deadlineAt: request.deadlineAt,
    kind: request.kind,
    operation: request.operation,
    ...(request.target
      ? {
          target: {
            semantic: request.target.semantic,
            expected: request.target.expected,
            candidateStrategies: request.target.candidates.map((candidate) => candidate.strategy),
          },
        }
      : {}),
    ...(request.args ? { args: { redacted: true, keys: Object.keys(request.args).sort() } } : {}),
    ...(request.capture ? { capture: request.capture } : {}),
    ...(request.presentation ? { presentation: request.presentation } : {}),
  };
}

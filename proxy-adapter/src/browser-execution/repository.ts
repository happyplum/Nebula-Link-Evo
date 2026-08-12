import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BrowserExecutionError } from './errors.js';
import type {
  BrowserExecutionProblem,
  BrowserLeaseRecord,
  BrowserOperationRecord,
  BrowserOperationRequestV1,
  BrowserOperationStatus,
  BrowserSessionRecord,
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

export interface StoredIdempotencyRecord {
  requestHash: string;
  resourceType: string;
  resourceId: string;
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

export class BrowserExecutionRepository {
  private db: DatabaseSync | null = null;

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

  transaction<T>(callback: () => T): T {
    const db = this.requireDb();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  private getOperationOrThrow(id: string): BrowserOperationRecord {
    const operation = this.getOperation(id);
    if (!operation) {
      throw new BrowserExecutionError('not_found', `Browser operation ${id} was not found`);
    }
    return operation;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Browser execution repository is not initialized');
    }
    return this.db;
  }

  private createSchema(): void {
    this.requireDb().exec(`
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
    `);
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

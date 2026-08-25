import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { Mutex } from 'async-mutex';
import { LocalBrowserArtifactStore, type BrowserArtifactStore } from './artifact-store.js';
import { BrowserExecutionError, toBrowserExecutionProblem } from './errors.js';
import { hashOpaqueToken, sha256, sha256Bytes } from './hash.js';
import { BrowserExecutionRepository } from './repository.js';
import { validateOperationInput } from './validation.js';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
  type BrowserExecutionCapabilities,
  type BrowserExecutionCredentials,
  type BrowserArtifactDownload,
  type BrowserArtifactRecord,
  type BrowserArtifactRefV1,
  type BrowserCaptureRecord,
  type BrowserLeaseRecord,
  type BrowserLeaseView,
  type BrowserOperationExecutionResult,
  type BrowserOperationName,
  type BrowserOperationRecord,
  type BrowserRawArtifact,
  type BrowserSessionEventRecord,
  type BrowserSessionOptions,
  type BrowserSessionRecord,
  type BrowserSessionView,
  type BrowserTabSummary,
  type CreateBrowserLeaseRequest,
  type ExecuteBrowserOperationInput,
  type IssuedBrowserLease,
} from './types.js';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const MAX_OBSERVE_LEASE_SECONDS = 30;
const MAX_CONTROL_LEASE_SECONDS = 300;

export interface BrowserExecutionBrowser {
  open(options: Required<Pick<BrowserSessionOptions, 'viewport' | 'cdpPort'>>): Promise<void>;
  close(): Promise<void>;
  getTabs(): Promise<BrowserTabSummary[]>;
  execute(input: ExecuteBrowserOperationInput): Promise<BrowserOperationExecutionResult>;
  captureScreenshot(tabId?: string): Promise<BrowserRawArtifact>;
  captureDomSnapshot(tabId?: string): Promise<BrowserRawArtifact>;
  setOnUnexpectedStateChange?(callback: (reason: string) => void): void;
}

export interface BrowserExecutionClock {
  now(): Date;
}

export interface BrowserExecutionServiceOptions {
  repository: BrowserExecutionRepository;
  browser: BrowserExecutionBrowser;
  clock?: BrowserExecutionClock;
  controlPlaneEnabled?: boolean;
  artifactStore?: BrowserArtifactStore;
}

export class BrowserExecutionService {
  private readonly repository: BrowserExecutionRepository;
  private readonly browser: BrowserExecutionBrowser;
  private readonly artifactStore: BrowserArtifactStore;
  private readonly clock: BrowserExecutionClock;
  private readonly stateMutex = new Mutex();
  private readonly operationMutex = new Mutex();
  private processEpoch = 0;
  private initialized = false;
  private readonly controlPlaneEnabled: boolean;
  private readonly sessionEvents = new EventEmitter();

  constructor(options: BrowserExecutionServiceOptions) {
    this.repository = options.repository;
    this.browser = options.browser;
    this.artifactStore =
      options.artifactStore ??
      new LocalBrowserArtifactStore(join(process.cwd(), 'data', 'proxy-adapter', 'artifacts'));
    this.clock = options.clock ?? { now: () => new Date() };
    this.controlPlaneEnabled = options.controlPlaneEnabled ?? true;
    this.browser.setOnUnexpectedStateChange?.((reason) => {
      this.handleUnexpectedBrowserState(reason);
    });
  }

  initialize(): void {
    if (this.initialized) {
      return;
    }
    this.processEpoch = this.repository.initialize();
    this.repository.recoverAfterRestart(this.now());
    this.initialized = true;
  }

  close(): void {
    this.repository.close();
    this.initialized = false;
  }

  async shutdown(): Promise<void> {
    await this.operationMutex.runExclusive(async () => {
      this.repository.close();
      this.initialized = false;
    });
  }

  getCapabilities(): BrowserExecutionCapabilities {
    this.assertInitialized();
    return {
      schema: 'nebula.service-capabilities/1.0',
      service: 'proxy-adapter',
      serviceVersion: '1.0.0',
      protocols: {
        browserExecution: { major: 1, minor: 0 },
        browserOperation: { major: 1, minor: 0 },
      },
      features: {
        persistentOperationLedger: true,
        visibleBrowser: true,
        liveView: true,
        storageStateSwitching: false,
        operationCaptureArtifacts: true,
        browserSessionEvents: true,
        artifactDownload: true,
        operationPresentationAnimation: false,
        localControlPlane: this.controlPlaneEnabled,
        observeLeaseSingleUse: true,
        supportedObservations: OBSERVE_OPERATIONS.join(','),
        supportedActions: ACT_OPERATIONS.join(','),
      },
      limits: {
        maxActiveBrowserSessions: 1,
        maxBrowserContextsPerSession: 1,
        maxControlLeasesPerSession: 1,
        maxObserveLeaseSeconds: MAX_OBSERVE_LEASE_SECONDS,
        maxControlLeaseSeconds: MAX_CONTROL_LEASE_SECONDS,
      },
      generatedAt: this.now(),
    };
  }

  hasActiveSession(): boolean {
    if (!this.initialized) {
      return false;
    }
    return this.repository.findActiveSession()?.status === 'active';
  }

  assertDirectBrowserAccess(kind: 'read' | 'capture' | 'write'): void {
    if (!this.hasActiveSession() || kind === 'read') {
      return;
    }
    throw new BrowserExecutionError(
      'browser_busy',
      kind === 'capture'
        ? 'Direct browser capture is disabled while a controlled browser session is active'
        : 'Direct browser writes are disabled while a controlled browser session is active',
      { retryable: true }
    );
  }

  async createSession(
    idempotencyKey: string,
    options: BrowserSessionOptions = {}
  ): Promise<BrowserSessionView> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    assertIdempotencyKey(idempotencyKey);
    validateSessionOptions(options);

    return this.stateMutex.runExclusive(async () => {
      const normalized = {
        viewport: options.viewport ?? DEFAULT_VIEWPORT,
        cdpPort: options.cdpPort ?? 9222,
        headless: false as const,
      };
      const requestHash = sha256(normalized);
      const replay = this.resolveIdempotency('session.create', idempotencyKey, requestHash);
      if (replay) {
        return this.getSession(replay.resourceId);
      }

      const active = this.repository.findActiveSession();
      if (active) {
        throw new BrowserExecutionError(
          'browser_busy',
          `Browser execution session ${active.id} is already active`,
          { retryable: true, details: { activeSessionId: active.id } }
        );
      }

      const now = this.now();
      const session: BrowserSessionRecord = {
        id: randomUUID(),
        status: 'opening',
        processEpoch: this.processEpoch,
        viewport: normalized.viewport,
        cdpPort: normalized.cdpPort,
        createdAt: now,
      };

      this.repository.transaction(() => {
        this.repository.insertSession(session);
        this.repository.insertIdempotency(
          'session.create',
          idempotencyKey,
          requestHash,
          'session',
          session.id,
          now
        );
      });
      this.recordEvent(session.id, 'browser_session.state_changed', 'session', session.id, {
        status: session.status,
        processEpoch: session.processEpoch,
      });

      try {
        await this.browser.open({ viewport: session.viewport, cdpPort: session.cdpPort });
        const activatedAt = this.now();
        this.repository.updateSessionStatus(session.id, 'active', { activatedAt });
        this.recordEvent(session.id, 'browser_session.state_changed', 'session', session.id, {
          status: 'active',
        });
        return this.getSession(session.id);
      } catch (error) {
        const problem = toBrowserExecutionProblem(
          new BrowserExecutionError('dependency_unavailable', 'Failed to open the visual browser', {
            retryable: true,
            details: { cause: error instanceof Error ? error.message : String(error) },
          }),
          session.id
        );
        this.repository.updateSessionStatus(session.id, 'failed', {
          closedAt: this.now(),
          failure: problem,
        });
        this.recordEvent(session.id, 'browser_session.state_changed', 'session', session.id, {
          status: 'failed',
          errorCode: problem.code,
        });
        throw new BrowserExecutionError('dependency_unavailable', problem.message, {
          retryable: true,
          details: problem.details,
        });
      }
    });
  }

  async getSession(sessionId: string): Promise<BrowserSessionView> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    const session = this.getSessionRecord(sessionId);
    this.repository.expireLeases(this.now());
    const isLive = session.status === 'active' && session.processEpoch === this.processEpoch;
    const tabs = isLive ? await this.browser.getTabs() : [];
    const activeLeases = this.repository.listActiveLeases(session.id, this.now()).map(toLeaseView);
    return {
      ...session,
      tabs,
      activeLeases,
      liveView: {
        available: isLive,
        controlAllowed: false,
      },
    };
  }

  async closeSession(
    sessionId: string,
    idempotencyKey: string,
    credentials?: BrowserExecutionCredentials
  ): Promise<BrowserSessionView> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    assertIdempotencyKey(idempotencyKey);
    return this.stateMutex.runExclusive(async () => {
      const requestHash = sha256({ sessionId });
      const replay = this.resolveIdempotency(
        `session.close:${sessionId}`,
        idempotencyKey,
        requestHash
      );
      if (replay) {
        return this.getSession(sessionId);
      }

      const session = this.getSessionRecord(sessionId);
      if (session.status === 'closed') {
        this.repository.insertIdempotency(
          `session.close:${sessionId}`,
          idempotencyKey,
          requestHash,
          'session',
          sessionId,
          this.now()
        );
        return this.getSession(sessionId);
      }
      if (session.status === 'active') {
        if (!credentials) {
          throw new BrowserExecutionError(
            'permission_denied',
            'An active control lease is required to close the browser session'
          );
        }
        this.validateLease(credentials, { requiredMode: 'control' });
      }

      if (session.status === 'active' && session.processEpoch === this.processEpoch) {
        await this.browser.close();
      }
      const closedAt = this.now();
      this.repository.transaction(() => {
        this.repository.closeSessionResources(sessionId, closedAt);
        this.repository.insertIdempotency(
          `session.close:${sessionId}`,
          idempotencyKey,
          requestHash,
          'session',
          sessionId,
          closedAt
        );
      });
      this.recordEvent(sessionId, 'browser_session.state_changed', 'session', sessionId, {
        status: 'closed',
      });
      return this.getSession(sessionId);
    });
  }

  async createLease(
    sessionId: string,
    idempotencyKey: string,
    input: CreateBrowserLeaseRequest
  ): Promise<IssuedBrowserLease> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    assertIdempotencyKey(idempotencyKey);
    validateLeaseRequest(input);

    return this.stateMutex.runExclusive(async () => {
      const requestHash = sha256({ sessionId, ...input });
      const replay = this.resolveIdempotency(
        `lease.create:${sessionId}`,
        idempotencyKey,
        requestHash
      );
      if (replay) {
        const lease = this.getLeaseRecord(replay.resourceId);
        return { lease: toLeaseView(lease), tokenIssued: false };
      }

      const session = this.requireLiveSession(sessionId);
      this.repository.expireLeases(this.now());
      const activeLeases = this.repository.listActiveLeases(session.id, this.now());
      if (input.mode === 'control' && activeLeases.some((lease) => lease.mode === 'control')) {
        throw new BrowserExecutionError(
          'browser_busy',
          'A control lease is already active for this browser session',
          { retryable: true }
        );
      }

      const tabs = await this.browser.getTabs();
      const defaultTab = tabs.find((tab) => tab.isActive) ?? tabs[0];
      if (!defaultTab) {
        throw new BrowserExecutionError(
          'dependency_unavailable',
          'The browser session has no active tab',
          {
            retryable: true,
          }
        );
      }
      const tabIds = input.tabIds?.length ? [...new Set(input.tabIds)] : [defaultTab.id];
      const currentTabIds = new Set(tabs.map((tab) => tab.id));
      const unknownTabs = tabIds.filter((tabId) => !currentTabIds.has(tabId));
      if (unknownTabs.length > 0) {
        throw new BrowserExecutionError(
          'validation_failed',
          'Lease contains unknown browser tabs',
          {
            details: { unknownTabIds: unknownTabs },
          }
        );
      }

      const modeOperations: BrowserOperationName[] =
        input.mode === 'observe'
          ? [...OBSERVE_OPERATIONS]
          : [...OBSERVE_OPERATIONS, ...ACT_OPERATIONS];
      const operations = input.operations?.length ? [...new Set(input.operations)] : modeOperations;
      const disallowed = operations.filter((operation) => !modeOperations.includes(operation));
      if (disallowed.length > 0) {
        throw new BrowserExecutionError(
          'permission_denied',
          'Lease requests operations that are not available for its mode',
          { details: { disallowedOperations: disallowed } }
        );
      }
      if (input.mode === 'observe' && this.operationMutex.isLocked()) {
        throw new BrowserExecutionError(
          'browser_busy',
          'Observe leases can only be issued at an atomic operation boundary',
          { retryable: true }
        );
      }

      const maxTtl =
        input.mode === 'observe' ? MAX_OBSERVE_LEASE_SECONDS : MAX_CONTROL_LEASE_SECONDS;
      const ttlSeconds = input.ttlSeconds ?? maxTtl;
      const nowDate = this.clock.now();
      const token = randomBytes(32).toString('base64url');
      const lease: BrowserLeaseRecord = {
        id: randomUUID(),
        sessionId,
        mode: input.mode,
        sequence: this.repository.nextLeaseSequence(sessionId),
        processEpoch: this.processEpoch,
        status: 'active',
        policy: { tabIds, operations },
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(nowDate.getTime() + ttlSeconds * 1000).toISOString(),
        createdAt: nowDate.toISOString(),
      };
      this.repository.transaction(() => {
        this.repository.insertLease(lease);
        this.repository.insertIdempotency(
          `lease.create:${sessionId}`,
          idempotencyKey,
          requestHash,
          'lease',
          lease.id,
          lease.createdAt
        );
      });
      this.recordEvent(sessionId, 'lease.issued', 'lease', lease.id, {
        mode: lease.mode,
        sequence: lease.sequence,
        expiresAt: lease.expiresAt,
      });
      return { lease: toLeaseView(lease), token, tokenIssued: true };
    });
  }

  async revokeLease(
    credentials: BrowserExecutionCredentials,
    idempotencyKey: string
  ): Promise<BrowserLeaseView> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    assertIdempotencyKey(idempotencyKey);
    return this.stateMutex.runExclusive(async () => {
      const requestHash = sha256({
        sessionId: credentials.sessionId,
        leaseId: credentials.leaseId,
      });
      const scope = `lease.revoke:${credentials.leaseId}`;
      const replay = this.resolveIdempotency(scope, idempotencyKey, requestHash);
      if (replay) {
        return toLeaseView(this.getLeaseRecord(replay.resourceId));
      }
      const lease = this.validateLease(credentials);
      const revokedAt = this.now();
      this.repository.transaction(() => {
        this.repository.revokeLease(lease.id, revokedAt);
        this.repository.insertIdempotency(
          scope,
          idempotencyKey,
          requestHash,
          'lease',
          lease.id,
          revokedAt
        );
      });
      this.recordEvent(lease.sessionId, 'lease.revoked', 'lease', lease.id, {
        status: 'revoked',
        reason: 'requested',
      });
      return toLeaseView(this.getLeaseRecord(lease.id));
    });
  }

  async executeOperation(input: ExecuteBrowserOperationInput): Promise<BrowserOperationRecord> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    validateOperationInput(input);
    const requestHash = sha256({
      sessionId: input.sessionId,
      leaseId: input.leaseId,
      tabId: input.tabId,
      request: input.request,
    });

    const existing = this.repository.getOperation(input.request.operationId);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new BrowserExecutionError(
          'idempotency_conflict',
          `Operation ${input.request.operationId} was already submitted with a different request`
        );
      }
      return existing;
    }

    this.validateOperationLease(input);
    this.rejectUnsupportedFeatures(input);
    const captureRequest = effectiveCaptureRequest(input);
    const accepted = this.repository.insertOperation({
      requestHash,
      input,
      acceptedAt: this.now(),
    });
    this.recordEvent(input.sessionId, 'operation.queued', 'operation', accepted.operationId, {
      status: accepted.status,
      queueSequence: accepted.queueSequence,
    });
    const capture = this.createCapture(accepted, captureRequest);

    return this.operationMutex.runExclusive(async () => {
      const queued = this.repository.getOperation(accepted.operationId);
      if (!queued || queued.status !== 'queued') {
        return queued ?? accepted;
      }

      try {
        this.validateOperationLease(input);
        this.assertBeforeDeadline(input.request.deadlineAt);
      } catch (error) {
        const completed = this.repository.completeOperation(
          accepted.operationId,
          'cancelled',
          this.now(),
          {
            error: toBrowserExecutionProblem(error, accepted.operationId),
          }
        );
        this.finishCapture(capture, 0);
        this.recordOperationCompleted(completed);
        return completed;
      }

      const running = this.repository.markOperationRunning(accepted.operationId, this.now());
      this.recordEvent(input.sessionId, 'operation.started', 'operation', running.operationId, {
        status: running.status,
      });
      const artifacts: BrowserArtifactRefV1[] = [];
      let capturedRequestedItems = 0;
      if (captureRequest?.beforeScreenshot) {
        const artifact = await this.captureArtifact(accepted, capture?.id, 'before', 'screenshot');
        if (artifact.ref) {
          artifacts.push(artifact.ref);
          capturedRequestedItems += 1;
        }
      }

      try {
        const lease = this.validateOperationLease(input);
        const result = await this.browser.execute(input);
        const actual =
          input.request.operation === 'tabs' && Array.isArray(result.actual)
            ? result.actual.filter((tab) => {
                return (
                  tab &&
                  typeof tab === 'object' &&
                  'id' in tab &&
                  typeof tab.id === 'string' &&
                  lease.policy.tabIds.includes(tab.id)
                );
              })
            : result.actual;
        if (captureRequest?.afterScreenshot) {
          const artifact = await this.captureArtifact(accepted, capture?.id, 'after', 'screenshot');
          if (artifact.ref) {
            artifacts.push(artifact.ref);
            capturedRequestedItems += 1;
          }
        }
        if (captureRequest?.domSnapshot) {
          const artifact = await this.captureArtifact(
            accepted,
            capture?.id,
            'observation',
            'dom_snapshot'
          );
          if (artifact.ref) {
            artifacts.push(artifact.ref);
            capturedRequestedItems += 1;
          }
        }
        this.finishCapture(capture, capturedRequestedItems);
        const completed = this.repository.completeOperation(
          accepted.operationId,
          'succeeded',
          this.now(),
          {
            actual,
            resolvedTarget: result.resolvedTarget,
            artifacts: [...(result.artifacts ?? []), ...artifacts],
          }
        );
        this.consumeObserveLease(input.leaseId);
        this.recordOperationCompleted(completed);
        return completed;
      } catch (error) {
        const failureScreenshot = await this.captureArtifact(
          accepted,
          capture?.id,
          'failure',
          'screenshot'
        );
        if (failureScreenshot.ref) artifacts.push(failureScreenshot.ref);
        if (captureRequest?.domSnapshot) {
          const domArtifact = await this.captureArtifact(
            accepted,
            capture?.id,
            'observation',
            'dom_snapshot'
          );
          if (domArtifact.ref) {
            artifacts.push(domArtifact.ref);
            capturedRequestedItems += 1;
          }
        }
        this.finishCapture(capture, capturedRequestedItems);
        const definiteFailure = error instanceof BrowserExecutionError;
        const status =
          input.request.kind === 'act' && !definiteFailure ? 'outcome_unknown' : 'failed';
        const normalized =
          status === 'outcome_unknown'
            ? new BrowserExecutionError(
                'outcome_unknown',
                'The browser action started but its side effect could not be proven',
                {
                  details: { cause: error instanceof Error ? error.message : String(error) },
                }
              )
            : error;
        const completed = this.repository.completeOperation(
          accepted.operationId,
          status,
          this.now(),
          {
            error: toBrowserExecutionProblem(normalized, accepted.operationId),
            artifacts,
          }
        );
        this.consumeObserveLease(input.leaseId);
        this.recordOperationCompleted(completed);
        return completed;
      }
    });
  }

  getOperation(operationId: string): BrowserOperationRecord {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    const operation = this.repository.getOperation(operationId);
    if (!operation) {
      throw new BrowserExecutionError(
        'not_found',
        `Browser operation ${operationId} was not found`
      );
    }
    return operation;
  }

  async getArtifactDownload(
    sessionId: string,
    artifactId: string
  ): Promise<BrowserArtifactDownload> {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    this.getSessionRecord(sessionId);
    const artifact = this.repository.getArtifact(artifactId);
    if (!artifact || artifact.sessionId !== sessionId) {
      throw new BrowserExecutionError('not_found', `Browser artifact ${artifactId} was not found`);
    }
    if (
      artifact.status !== 'available' ||
      !artifact.storageRef ||
      !artifact.sha256 ||
      artifact.sizeBytes === undefined
    ) {
      throw new BrowserExecutionError(
        'state_conflict',
        `Browser artifact ${artifactId} is not available`,
        { details: { status: artifact.status } }
      );
    }
    let bytes: Buffer;
    try {
      bytes = await this.artifactStore.read(artifact.storageRef);
    } catch (error) {
      throw new BrowserExecutionError(
        'dependency_unavailable',
        `Browser artifact ${artifactId} could not be read`,
        {
          details: { cause: error instanceof Error ? error.message : String(error) },
        }
      );
    }
    const actualSha256 = sha256Bytes(bytes);
    if (bytes.byteLength !== artifact.sizeBytes || actualSha256 !== artifact.sha256) {
      throw new BrowserExecutionError(
        'state_conflict',
        `Browser artifact ${artifactId} failed integrity validation`,
        {
          details: {
            expectedSha256: artifact.sha256,
            actualSha256,
            expectedSizeBytes: artifact.sizeBytes,
            actualSizeBytes: bytes.byteLength,
          },
        }
      );
    }
    return { artifact, bytes };
  }

  async cleanupExpiredArtifacts(): Promise<{ recordsDeleted: number; filesDeleted: number }> {
    this.assertInitialized();
    return this.operationMutex.runExclusive(async () => {
      const deletedAt = this.now();
      const artifacts = this.repository.listArtifactsEligibleForDeletion(deletedAt);
      let recordsDeleted = 0;
      let filesDeleted = 0;

      for (const artifact of artifacts) {
        const claimed = this.repository.claimArtifactDeletion(artifact.id);
        let fileDeleted = false;
        if (
          claimed.storageBackend === 'local_file' &&
          claimed.storageRef &&
          !this.repository.hasOtherArtifactStorageReference(claimed.storageRef, claimed.id)
        ) {
          fileDeleted = await this.artifactStore.delete(claimed.storageRef);
          if (fileDeleted) filesDeleted += 1;
        }
        const deleted = this.repository.markArtifactDeleted(claimed.id, deletedAt);
        recordsDeleted += 1;
        this.recordEvent(deleted.sessionId, 'artifact.deleted', 'artifact', deleted.id, {
          retentionClass: deleted.retentionClass,
          expiresAt: deleted.expiresAt,
          fileDeleted,
        });
      }

      return { recordsDeleted, filesDeleted };
    });
  }

  listSessionEvents(sessionId: string, afterSeq = 0, limit = 100): BrowserSessionEventRecord[] {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    this.getSessionRecord(sessionId);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new BrowserExecutionError(
        'validation_failed',
        'afterSeq must be a non-negative integer'
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new BrowserExecutionError('validation_failed', 'limit must be between 1 and 1000');
    }
    return this.repository.listSessionEvents(sessionId, afterSeq, limit);
  }

  async getSessionEventSnapshot(sessionId: string) {
    const session = await this.getSession(sessionId);
    return {
      type: 'browser_session.snapshot' as const,
      seq: this.repository.getLastSessionEventSeq(sessionId),
      session,
    };
  }

  subscribeSessionEvents(
    sessionId: string,
    listener: (event: BrowserSessionEventRecord) => void
  ): () => void {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    this.getSessionRecord(sessionId);
    const eventName = sessionEventName(sessionId);
    this.sessionEvents.on(eventName, listener);
    return () => this.sessionEvents.off(eventName, listener);
  }

  cancelOperation(
    operationId: string,
    credentials: BrowserExecutionCredentials
  ): BrowserOperationRecord {
    this.assertInitialized();
    this.assertControlPlaneEnabled();
    const operation = this.getOperation(operationId);
    if (
      operation.sessionId !== credentials.sessionId ||
      operation.leaseId !== credentials.leaseId
    ) {
      throw new BrowserExecutionError(
        'permission_denied',
        'The lease does not own this browser operation'
      );
    }
    this.validateLease(credentials);
    if (operation.status !== 'queued') {
      throw new BrowserExecutionError(
        'state_conflict',
        `Browser operation ${operationId} cannot be cancelled after it has started`,
        { details: { status: operation.status } }
      );
    }
    const cancelled = this.repository.cancelQueuedOperation(
      operationId,
      this.now(),
      toBrowserExecutionProblem(
        new BrowserExecutionError('state_conflict', 'Browser operation cancelled before start'),
        operationId
      )
    );
    this.recordOperationCompleted(cancelled);
    return cancelled;
  }

  private createCapture(
    operation: BrowserOperationRecord,
    requested: BrowserCaptureRecord['requested'] | undefined
  ): BrowserCaptureRecord | undefined {
    if (!requested) return undefined;
    const expectedItemCount = [
      requested.beforeScreenshot,
      requested.afterScreenshot,
      requested.domSnapshot,
    ].filter(Boolean).length;
    if (expectedItemCount === 0) return undefined;
    const capture = this.repository.createCapture({
      id: randomUUID(),
      operationId: operation.operationId,
      requestHash: sha256(requested),
      requested,
      expectedItemCount,
      createdAt: this.now(),
    });
    this.recordEvent(operation.sessionId, 'capture.started', 'capture', capture.id, {
      operationId: operation.operationId,
      expectedItemCount,
    });
    return capture;
  }

  private async captureArtifact(
    operation: BrowserOperationRecord,
    captureId: string | undefined,
    phase: BrowserArtifactRecord['capturePhase'],
    kind: Extract<BrowserArtifactRecord['kind'], 'screenshot' | 'dom_snapshot'>
  ): Promise<{ artifact: BrowserArtifactRecord; ref?: BrowserArtifactRefV1 }> {
    const id = randomUUID();
    const createdAt = this.now();
    const retentionClass = phase === 'failure' ? 'failure_30d' : 'success_7d';
    const expiresAt = addDays(createdAt, phase === 'failure' ? 30 : 7);
    let raw: BrowserRawArtifact;
    let stored: Awaited<ReturnType<BrowserArtifactStore['write']>>;
    try {
      raw =
        kind === 'screenshot'
          ? await this.browser.captureScreenshot(operation.tabId)
          : await this.browser.captureDomSnapshot(operation.tabId);
      if (raw.kind !== kind) {
        throw new BrowserExecutionError(
          'state_conflict',
          `Browser capture returned ${raw.kind} instead of ${kind}`
        );
      }
      stored = await this.artifactStore.write(kind, raw.bytes);
    } catch (error) {
      const problem = toBrowserExecutionProblem(error, id);
      const artifact = this.repository.insertArtifact({
        id,
        sessionId: operation.sessionId,
        operationId: operation.operationId,
        ...(captureId ? { captureId } : {}),
        ...(operation.tabId ? { tabId: operation.tabId } : {}),
        kind,
        capturePhase: phase,
        status: 'failed',
        completeness: 'failed',
        mimeType: kind === 'screenshot' ? 'image/png' : 'application/json',
        storageBackend: 'local_file',
        redactionStatus: 'failed',
        retentionClass,
        expiresAt,
        createdAt,
        error: problem,
      });
      this.recordEvent(operation.sessionId, 'artifact.created', 'artifact', artifact.id, {
        operationId: operation.operationId,
        kind: artifact.kind,
        capturePhase: artifact.capturePhase,
        status: artifact.status,
        errorCode: problem.code,
      });
      return { artifact };
    }
    const artifact = this.repository.insertArtifact({
      id,
      sessionId: operation.sessionId,
      operationId: operation.operationId,
      ...(captureId ? { captureId } : {}),
      ...(operation.tabId ? { tabId: operation.tabId } : {}),
      kind,
      capturePhase: phase,
      status: 'available',
      completeness: 'complete',
      mimeType: raw.mimeType,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      storageBackend: 'local_file',
      storageRef: stored.storageRef,
      redactionStatus: 'pending',
      retentionClass,
      expiresAt,
      createdAt,
      availableAt: this.now(),
    });
    this.recordEvent(operation.sessionId, 'artifact.created', 'artifact', artifact.id, {
      operationId: operation.operationId,
      kind: artifact.kind,
      capturePhase: artifact.capturePhase,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      status: artifact.status,
      ...(raw.snapshotId ? { snapshotId: raw.snapshotId } : {}),
    });
    return {
      artifact,
      ref: {
        id: artifact.id,
        kind: artifact.kind,
        sha256: stored.sha256,
        mimeType: artifact.mimeType,
        sizeBytes: stored.sizeBytes,
        ...(raw.snapshotId ? { snapshotId: raw.snapshotId } : {}),
      },
    };
  }

  private finishCapture(capture: BrowserCaptureRecord | undefined, actualItemCount: number): void {
    if (!capture) return;
    const completeness =
      actualItemCount === capture.expectedItemCount
        ? 'complete'
        : actualItemCount > 0
          ? 'partial'
          : 'failed';
    const status = completeness === 'failed' ? 'failed' : 'completed';
    const completed = this.repository.completeCapture(capture.id, {
      status,
      completeness,
      actualItemCount,
      completedAt: this.now(),
      ...(completeness === 'complete'
        ? {}
        : {
            error: toBrowserExecutionProblem(
              new BrowserExecutionError(
                'dependency_unavailable',
                'One or more requested browser artifacts could not be captured'
              ),
              capture.id
            ),
          }),
    });
    this.recordEvent(capture.sessionId, 'capture.completed', 'capture', capture.id, {
      operationId: capture.operationId,
      status: completed.status,
      completeness: completed.completeness,
      expectedItemCount: completed.expectedItemCount,
      actualItemCount: completed.actualItemCount,
    });
  }

  private recordOperationCompleted(operation: BrowserOperationRecord): void {
    this.recordEvent(
      operation.sessionId,
      'operation.completed',
      'operation',
      operation.operationId,
      {
        status: operation.status,
        artifactIds: operation.artifacts.map((artifact) => artifact.id),
        ...(operation.error ? { errorCode: operation.error.code } : {}),
      }
    );
  }

  private recordEvent(
    sessionId: string,
    type: string,
    entityType: BrowserSessionEventRecord['entityType'],
    entityId: string,
    payload: Record<string, unknown>
  ): BrowserSessionEventRecord {
    const occurredAt = this.now();
    const event = this.repository.appendSessionEvent({
      id: randomUUID(),
      sessionId,
      type,
      entityType,
      entityId,
      payload,
      occurredAt,
    });
    this.sessionEvents.emit(sessionEventName(sessionId), event);
    return event;
  }

  private resolveIdempotency(scope: string, key: string, requestHash: string) {
    const existing = this.repository.findIdempotency(scope, key);
    if (!existing) {
      return undefined;
    }
    if (existing.requestHash !== requestHash) {
      throw new BrowserExecutionError(
        'idempotency_conflict',
        `Idempotency key ${key} was already used with a different request`
      );
    }
    return existing;
  }

  private getSessionRecord(sessionId: string): BrowserSessionRecord {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      throw new BrowserExecutionError('not_found', `Browser session ${sessionId} was not found`);
    }
    return session;
  }

  private requireLiveSession(sessionId: string): BrowserSessionRecord {
    const session = this.getSessionRecord(sessionId);
    if (session.status !== 'active' || session.processEpoch !== this.processEpoch) {
      throw new BrowserExecutionError(
        'state_conflict',
        'Browser session is not active in this process',
        {
          details: { status: session.status },
        }
      );
    }
    return session;
  }

  private getLeaseRecord(leaseId: string): BrowserLeaseRecord {
    const lease = this.repository.getLease(leaseId);
    if (!lease) {
      throw new BrowserExecutionError('not_found', `Browser lease ${leaseId} was not found`);
    }
    return lease;
  }

  private validateLease(
    credentials: BrowserExecutionCredentials,
    options: { requiredMode?: 'control' } = {}
  ): BrowserLeaseRecord {
    this.requireLiveSession(credentials.sessionId);
    this.repository.expireLeases(this.now());
    const lease = this.getLeaseRecord(credentials.leaseId);
    if (lease.sessionId !== credentials.sessionId) {
      throw new BrowserExecutionError(
        'permission_denied',
        'Browser lease does not belong to the session'
      );
    }
    if (lease.status !== 'active' || lease.processEpoch !== this.processEpoch) {
      throw new BrowserExecutionError('lease_expired', 'Browser lease is no longer active');
    }
    if (options.requiredMode === 'control' && lease.mode !== 'control') {
      throw new BrowserExecutionError('permission_denied', 'A control lease is required');
    }
    const suppliedHash = Buffer.from(hashOpaqueToken(credentials.leaseToken), 'hex');
    const storedHash = Buffer.from(lease.tokenHash, 'hex');
    if (suppliedHash.length !== storedHash.length || !timingSafeEqual(suppliedHash, storedHash)) {
      throw new BrowserExecutionError('permission_denied', 'Browser lease token is invalid');
    }
    return lease;
  }

  private validateOperationLease(input: ExecuteBrowserOperationInput): BrowserLeaseRecord {
    const lease = this.validateLease(input, {
      requiredMode: input.request.kind === 'act' ? 'control' : undefined,
    });
    if (input.request.leaseSequence !== lease.sequence) {
      throw new BrowserExecutionError('permission_denied', 'Browser lease sequence does not match');
    }
    if (!lease.policy.operations.includes(input.request.operation)) {
      throw new BrowserExecutionError(
        'permission_denied',
        'Browser operation is outside the lease policy'
      );
    }
    if (input.tabId && !lease.policy.tabIds.includes(input.tabId)) {
      throw new BrowserExecutionError(
        'permission_denied',
        'Browser tab is outside the lease policy'
      );
    }
    for (const field of ['tabId', 'returnToTabId'] as const) {
      const tabId = input.request.args?.[field];
      if (typeof tabId === 'string' && !lease.policy.tabIds.includes(tabId)) {
        throw new BrowserExecutionError(
          'permission_denied',
          `Browser operation ${field} is outside the lease policy`
        );
      }
    }
    return lease;
  }

  private rejectUnsupportedFeatures(input: ExecuteBrowserOperationInput): void {
    if (input.request.capture?.videoSegment) {
      throw new BrowserExecutionError(
        'validation_failed',
        'Browser video segment capture is not available in this delivery phase'
      );
    }
    if (input.request.presentation && input.request.presentation.animation !== 'off') {
      throw new BrowserExecutionError(
        'validation_failed',
        'Browser operation presentation animation is not available in this delivery phase'
      );
    }
  }

  private assertBeforeDeadline(deadlineAt: string): void {
    if (new Date(deadlineAt).getTime() <= this.clock.now().getTime()) {
      throw new BrowserExecutionError('state_conflict', 'Browser operation deadline has passed');
    }
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  private consumeObserveLease(leaseId: string): void {
    const lease = this.repository.getLease(leaseId);
    if (lease?.mode === 'observe' && lease.status === 'active') {
      this.repository.revokeLease(lease.id, this.now());
      this.recordEvent(lease.sessionId, 'lease.revoked', 'lease', lease.id, {
        status: 'revoked',
        reason: 'observe_operation_consumed',
      });
    }
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('Browser execution service is not initialized');
    }
  }

  private assertControlPlaneEnabled(): void {
    if (!this.controlPlaneEnabled) {
      throw new BrowserExecutionError(
        'permission_denied',
        'Browser execution control is disabled when proxy-adapter is bound beyond loopback'
      );
    }
  }

  private handleUnexpectedBrowserState(reason: string): void {
    if (!this.initialized) {
      return;
    }
    const active = this.repository.findActiveSession();
    if (!active) return;
    const problem = toBrowserExecutionProblem(
      new BrowserExecutionError('dependency_unavailable', 'Visual browser state was interrupted', {
        retryable: true,
        details: { reason },
      }),
      randomUUID()
    );
    this.repository.interruptActiveSession(this.now(), problem);
    this.recordEvent(active.id, 'browser_session.state_changed', 'session', active.id, {
      status: 'interrupted',
      errorCode: problem.code,
      reason,
    });
  }
}

function effectiveCaptureRequest(
  input: ExecuteBrowserOperationInput
): BrowserCaptureRecord['requested'] | undefined {
  if (!input.request.capture && input.request.operation !== 'dom_snapshot') {
    return undefined;
  }
  return {
    ...input.request.capture,
    ...(input.request.operation === 'dom_snapshot' ? { domSnapshot: true } : {}),
  };
}

function addDays(timestamp: string, days: number): string {
  return new Date(new Date(timestamp).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function sessionEventName(sessionId: string): string {
  return `browser-session:${sessionId}`;
}

function toLeaseView(lease: BrowserLeaseRecord): BrowserLeaseView {
  const { tokenHash: _tokenHash, ...view } = lease;
  return view;
}

function validateSessionOptions(options: BrowserSessionOptions): void {
  if (options.headless === (true as never)) {
    throw new BrowserExecutionError(
      'validation_failed',
      'Controlled browser sessions must remain visible'
    );
  }
  if (options.viewport) {
    const { width, height } = options.viewport;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || height < 240) {
      throw new BrowserExecutionError('validation_failed', 'Viewport dimensions are invalid');
    }
  }
  if (
    options.cdpPort !== undefined &&
    (!Number.isInteger(options.cdpPort) || options.cdpPort < 0 || options.cdpPort > 65535)
  ) {
    throw new BrowserExecutionError('validation_failed', 'CDP port is invalid');
  }
}

function validateLeaseRequest(input: CreateBrowserLeaseRequest): void {
  if (input.mode !== 'observe' && input.mode !== 'control') {
    throw new BrowserExecutionError('validation_failed', 'Browser lease mode is invalid');
  }
  const max = input.mode === 'observe' ? MAX_OBSERVE_LEASE_SECONDS : MAX_CONTROL_LEASE_SECONDS;
  if (
    input.ttlSeconds !== undefined &&
    (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > max)
  ) {
    throw new BrowserExecutionError(
      'validation_failed',
      `Browser lease ttlSeconds must be between 1 and ${max}`
    );
  }
}

function assertIdempotencyKey(key: string): void {
  if (!key || key.length > 200) {
    throw new BrowserExecutionError(
      'validation_failed',
      'Idempotency-Key is required and must not exceed 200 characters'
    );
  }
}

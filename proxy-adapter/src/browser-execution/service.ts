import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { BrowserExecutionError, toBrowserExecutionProblem } from './errors.js';
import { hashOpaqueToken, sha256 } from './hash.js';
import { BrowserExecutionRepository } from './repository.js';
import { validateOperationInput } from './validation.js';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
  type BrowserExecutionCapabilities,
  type BrowserExecutionCredentials,
  type BrowserLeaseRecord,
  type BrowserLeaseView,
  type BrowserOperationExecutionResult,
  type BrowserOperationName,
  type BrowserOperationRecord,
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
}

export class BrowserExecutionService {
  private readonly repository: BrowserExecutionRepository;
  private readonly browser: BrowserExecutionBrowser;
  private readonly clock: BrowserExecutionClock;
  private readonly stateMutex = new Mutex();
  private readonly operationMutex = new Mutex();
  private processEpoch = 0;
  private initialized = false;
  private readonly controlPlaneEnabled: boolean;

  constructor(options: BrowserExecutionServiceOptions) {
    this.repository = options.repository;
    this.browser = options.browser;
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
        operationCaptureArtifacts: false,
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

  assertLegacyBrowserAccess(kind: 'read' | 'capture' | 'write'): void {
    if (!this.hasActiveSession() || kind === 'read') {
      return;
    }
    throw new BrowserExecutionError(
      'browser_busy',
      kind === 'capture'
        ? 'Direct browser capture is disabled while a controlled browser session is active'
        : 'Legacy browser writes are disabled while a controlled browser session is active',
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

      try {
        await this.browser.open({ viewport: session.viewport, cdpPort: session.cdpPort });
        const activatedAt = this.now();
        this.repository.updateSessionStatus(session.id, 'active', { activatedAt });
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
    this.rejectUnsupportedCapture(input);
    const accepted = this.repository.insertOperation({
      requestHash,
      input,
      acceptedAt: this.now(),
    });

    return this.operationMutex.runExclusive(async () => {
      const queued = this.repository.getOperation(accepted.operationId);
      if (!queued || queued.status !== 'queued') {
        return queued ?? accepted;
      }

      try {
        this.validateOperationLease(input);
        this.assertBeforeDeadline(input.request.deadlineAt);
      } catch (error) {
        return this.repository.completeOperation(accepted.operationId, 'cancelled', this.now(), {
          error: toBrowserExecutionProblem(error, accepted.operationId),
        });
      }

      this.repository.markOperationRunning(accepted.operationId, this.now());
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
        const completed = this.repository.completeOperation(
          accepted.operationId,
          'succeeded',
          this.now(),
          {
            actual,
            resolvedTarget: result.resolvedTarget,
            artifacts: result.artifacts ?? [],
          }
        );
        this.consumeObserveLease(input.leaseId);
        return completed;
      } catch (error) {
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
          { error: toBrowserExecutionProblem(normalized, accepted.operationId) }
        );
        this.consumeObserveLease(input.leaseId);
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
    return this.repository.cancelQueuedOperation(
      operationId,
      this.now(),
      toBrowserExecutionProblem(
        new BrowserExecutionError('state_conflict', 'Browser operation cancelled before start'),
        operationId
      )
    );
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

  private rejectUnsupportedCapture(input: ExecuteBrowserOperationInput): void {
    if (input.request.capture && Object.values(input.request.capture).some(Boolean)) {
      throw new BrowserExecutionError(
        'validation_failed',
        'Operation artifact capture is not available in this delivery phase'
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
    if (!this.initialized || !this.hasActiveSession()) {
      return;
    }
    const problem = toBrowserExecutionProblem(
      new BrowserExecutionError('dependency_unavailable', 'Visual browser state was interrupted', {
        retryable: true,
        details: { reason },
      }),
      randomUUID()
    );
    this.repository.interruptActiveSession(this.now(), problem);
  }
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

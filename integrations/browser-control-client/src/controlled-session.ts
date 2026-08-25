import { createHash, randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
  type ActOperation,
  type BrowserExecutionCredentials,
  type BrowserOperationKind,
  type BrowserOperationRecord,
  type BrowserOperationRequestV1,
  type BrowserSessionOptions,
  type BrowserSessionView,
  type BrowserTargetRefV1,
  type ObserveOperation,
} from '@nebula-link-evo/shared/types/browser-execution';
import { BrowserControlClient } from './client.js';
import { BrowserControlError, BrowserOutcomeUnknownError } from './errors.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);

export interface ControlledBrowserSessionOptions {
  attachSessionId?: string;
  session?: BrowserSessionOptions;
  leaseTtlSeconds?: number;
  leaseRefreshSkewSeconds?: number;
  operationTimeoutMs?: number;
  allowedObserveOperations?: readonly ObserveOperation[];
  allowedActOperations?: readonly ActOperation[];
  ownerId?: string;
}

export interface ControlledOperationInput {
  key: string;
  kind: BrowserOperationKind;
  operation: ObserveOperation | ActOperation;
  target?: BrowserTargetRefV1;
  args?: Record<string, unknown>;
  capture?: BrowserOperationRequestV1['capture'];
  label?: string;
}

export interface ActAuthorizationContext {
  operation: ActOperation;
  target?: BrowserTargetRefV1;
  args?: Record<string, unknown>;
}

export type AuthorizeAct = (context: ActAuthorizationContext) => Promise<boolean>;

export interface ControlledSessionState {
  ownerId: string;
  sessionId: string;
  tabId: string;
  leaseId: string;
  leaseSequence: number;
  leaseExpiresAt: string;
  ownsSession: boolean;
}

interface PrivateBinding extends ControlledSessionState {
  leaseToken: string;
}

export class ControlledBrowserSession {
  private readonly mutex = new Mutex();
  private readonly ownerId: string;
  private readonly leaseTtlSeconds: number;
  private readonly refreshSkewMs: number;
  private readonly operationTimeoutMs: number;
  private readonly allowedObserveOperations: readonly ObserveOperation[];
  private readonly allowedActOperations: readonly ActOperation[];
  private binding?: PrivateBinding;

  constructor(
    private readonly client: BrowserControlClient,
    private readonly options: ControlledBrowserSessionOptions = {}
  ) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.leaseTtlSeconds = options.leaseTtlSeconds ?? 300;
    this.refreshSkewMs = (options.leaseRefreshSkewSeconds ?? 30) * 1000;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 30_000;
    this.allowedObserveOperations = options.allowedObserveOperations ?? OBSERVE_OPERATIONS;
    this.allowedActOperations = options.allowedActOperations ?? ACT_OPERATIONS;
  }

  async start(signal?: AbortSignal): Promise<ControlledSessionState> {
    return this.mutex.runExclusive(async () => this.startUnlocked(signal));
  }

  getState(): ControlledSessionState | undefined {
    if (!this.binding) return undefined;
    const { leaseToken: _secret, ...state } = this.binding;
    return { ...state };
  }

  async execute(
    input: ControlledOperationInput,
    authorizeAct?: AuthorizeAct,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    return this.mutex.runExclusive(async () => {
      validateOperation(input, this.allowedObserveOperations, this.allowedActOperations);
      if (input.kind === 'act') {
        if (!authorizeAct) {
          throw new BrowserControlError(
            'permission_denied',
            'Act operations require an explicit authorization callback'
          );
        }
        const allowed = await authorizeAct({
          operation: input.operation as ActOperation,
          ...(input.target ? { target: input.target } : {}),
          ...(input.args ? { args: input.args } : {}),
        });
        if (!allowed) {
          throw new BrowserControlError(
            'permission_denied',
            'Browser act operation was not approved'
          );
        }
      }

      let binding = await this.startUnlocked(signal);
      binding = await this.rotateLeaseIfNeeded(binding, signal);
      const operationId = stableUuid(this.ownerId, input.key, input.kind, input.operation);
      // JSON/模型输入在 proxy 权威边界按判别 Schema 校验；凭证注入后才形成线协议请求。
      const request = {
        schema: 'nebula.browser.operation/1.0',
        operationId,
        leaseSequence: binding.leaseSequence,
        deadlineAt: new Date(Date.now() + this.operationTimeoutMs).toISOString(),
        kind: input.kind,
        operation: input.operation,
        ...(input.target ? { target: input.target } : {}),
        ...(input.args ? { args: input.args } : {}),
        ...(input.capture ? { capture: input.capture } : {}),
        presentation: {
          ...(input.label ? { label: input.label } : {}),
          animation: 'off',
        },
      } as BrowserOperationRequestV1;
      const credentials = credentialsFrom(binding);
      const timeoutSignal = AbortSignal.timeout(this.operationTimeoutMs);
      const operationSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      try {
        const operation = await this.client.executeOperation(
          credentials,
          binding.tabId,
          request,
          operationSignal
        );
        await this.refreshTabAfterOperation(operation, signal);
        return operation;
      } catch (error) {
        if (error instanceof BrowserControlError && error.code !== 'dependency_unavailable') {
          throw error;
        }
        if (operationSignal.aborted) {
          try {
            const cancelled = await this.client.cancelOperation(
              operationId,
              credentials,
              AbortSignal.timeout(Math.min(5_000, this.operationTimeoutMs))
            );
            if (TERMINAL_STATUSES.has(cancelled.status)) return cancelled;
          } catch {
            // Durable ledger recovery below remains authoritative.
          }
        }
        return this.recoverOperation(operationId, error);
      }
    });
  }

  async close(signal?: AbortSignal): Promise<void> {
    await this.mutex.runExclusive(async () => {
      const binding = this.binding;
      try {
        if (!binding) return;
        const credentials = credentialsFrom(binding);
        if (binding.ownsSession) {
          await this.client.closeSession(binding.sessionId, credentials, randomUUID(), signal);
        } else {
          await this.client.revokeLease(credentials, randomUUID(), signal);
        }
        this.binding = undefined;
      } finally {
        await this.client.close();
      }
    });
  }

  private async startUnlocked(signal?: AbortSignal): Promise<PrivateBinding> {
    if (this.binding) return this.binding;
    const capabilities = await this.client.getCapabilities(signal);
    for (const protocol of ['browserExecution', 'browserOperation']) {
      if (capabilities.protocols[protocol]?.major !== 1) {
        throw new BrowserControlError(
          'incompatible_capability',
          `proxy-adapter ${protocol} protocol major 1 is required`
        );
      }
    }
    if (capabilities.features.localControlPlane !== true) {
      throw new BrowserControlError(
        'permission_denied',
        'proxy-adapter local browser control plane is disabled'
      );
    }

    let session: BrowserSessionView;
    let ownsSession = false;
    if (this.options.attachSessionId) {
      session = await this.client.getSession(this.options.attachSessionId, signal);
      if (session.status !== 'active') {
        throw new BrowserControlError(
          'validation_failed',
          `Attached browser session ${session.id} is not active`
        );
      }
      if (session.activeLeases.some((lease) => lease.mode === 'control')) {
        throw new BrowserControlError(
          'browser_busy',
          `Attached browser session ${session.id} already has a control lease`,
          true
        );
      }
    } else {
      session = await this.client.createSession(this.options.session ?? {}, randomUUID(), signal);
      ownsSession = true;
    }

    const activeTab = session.tabs.find((tab) => tab.isActive) ?? session.tabs[0];
    if (!activeTab) {
      throw new BrowserControlError(
        'dependency_unavailable',
        `Browser session ${session.id} has no active tab`,
        true
      );
    }
    const issued = await this.client.createLease(
      session.id,
      {
        mode: 'control',
        ttlSeconds: this.leaseTtlSeconds,
        tabIds: [activeTab.id],
        operations: [...this.allowedObserveOperations, ...this.allowedActOperations],
      },
      randomUUID(),
      signal
    );
    if (!issued.token) {
      throw new BrowserControlError(
        'dependency_unavailable',
        'proxy-adapter did not issue a usable browser lease token',
        true
      );
    }
    this.binding = {
      ownerId: this.ownerId,
      sessionId: session.id,
      tabId: activeTab.id,
      leaseId: issued.lease.id,
      leaseToken: issued.token,
      leaseSequence: issued.lease.sequence,
      leaseExpiresAt: issued.lease.expiresAt,
      ownsSession,
    };
    return this.binding;
  }

  private async rotateLeaseIfNeeded(
    binding: PrivateBinding,
    signal?: AbortSignal
  ): Promise<PrivateBinding> {
    if (Date.parse(binding.leaseExpiresAt) - Date.now() > this.refreshSkewMs) return binding;
    const credentials = credentialsFrom(binding);
    await this.client.revokeLease(credentials, randomUUID(), signal);
    const issued = await this.client.createLease(
      binding.sessionId,
      {
        mode: 'control',
        ttlSeconds: this.leaseTtlSeconds,
        tabIds: [binding.tabId],
        operations: [...this.allowedObserveOperations, ...this.allowedActOperations],
      },
      randomUUID(),
      signal
    );
    if (!issued.token) {
      throw new BrowserControlError(
        'dependency_unavailable',
        'proxy-adapter did not issue a replacement browser lease token',
        true
      );
    }
    this.binding = {
      ...binding,
      leaseId: issued.lease.id,
      leaseToken: issued.token,
      leaseSequence: issued.lease.sequence,
      leaseExpiresAt: issued.lease.expiresAt,
    };
    return this.binding;
  }

  private async recoverOperation(
    operationId: string,
    executeError: unknown
  ): Promise<BrowserOperationRecord> {
    try {
      const operation = await this.client.getOperation(operationId);
      if (TERMINAL_STATUSES.has(operation.status)) return operation;
    } catch {
      // The original transport failure remains the relevant cause.
    }
    throw new BrowserOutcomeUnknownError(operationId, executeError);
  }

  private async refreshTabAfterOperation(
    operation: BrowserOperationRecord,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.binding || !['switch_tab', 'close_tab'].includes(operation.operation)) return;
    const session = await this.client.getSession(this.binding.sessionId, signal);
    const activeTab = session.tabs.find((tab) => tab.isActive) ?? session.tabs[0];
    if (activeTab) this.binding = { ...this.binding, tabId: activeTab.id };
  }
}

function validateOperation(
  input: ControlledOperationInput,
  allowedObserve: readonly ObserveOperation[],
  allowedAct: readonly ActOperation[]
): void {
  const allowed = input.kind === 'observe' ? allowedObserve : allowedAct;
  if (!(allowed as readonly string[]).includes(input.operation)) {
    throw new BrowserControlError(
      'validation_failed',
      `Operation ${input.operation} is not allowed for ${input.kind}`
    );
  }
}

function credentialsFrom(binding: PrivateBinding): BrowserExecutionCredentials {
  return {
    sessionId: binding.sessionId,
    leaseId: binding.leaseId,
    leaseToken: binding.leaseToken,
  };
}

export function stableUuid(...parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

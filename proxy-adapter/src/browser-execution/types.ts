export const OBSERVE_OPERATIONS = [
  'page_state',
  'dom_snapshot',
  'target_state',
  'url',
  'title',
  'text',
  'value',
  'attribute',
  'count',
  'tabs',
] as const;

export const ACT_OPERATIONS = [
  'navigate',
  'click',
  'fill',
  'type_text',
  'press',
  'select_option',
  'check',
  'uncheck',
  'focus',
  'blur',
  'hover',
  'scroll',
  'switch_tab',
  'close_tab',
] as const;

export type ObserveOperation = (typeof OBSERVE_OPERATIONS)[number];
export type ActOperation = (typeof ACT_OPERATIONS)[number];
export type BrowserOperationName = ObserveOperation | ActOperation;
export type BrowserOperationKind = 'observe' | 'act';
export type BrowserLeaseMode = 'observe' | 'control';
export type BrowserSessionStatus = 'opening' | 'active' | 'closed' | 'interrupted' | 'failed';
export type BrowserLeaseStatus = 'active' | 'revoked' | 'expired';
export type BrowserOperationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';

export interface BrowserTabSummary {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

export interface BrowserSessionOptions {
  viewport?: { width: number; height: number };
  cdpPort?: number;
  headless?: false;
}

export interface BrowserSessionRecord {
  id: string;
  status: BrowserSessionStatus;
  processEpoch: number;
  viewport: { width: number; height: number };
  cdpPort: number;
  createdAt: string;
  activatedAt?: string;
  closedAt?: string;
  failure?: BrowserExecutionProblem;
}

export interface BrowserSessionView extends BrowserSessionRecord {
  tabs: BrowserTabSummary[];
  activeLeases: BrowserLeaseView[];
  liveView: {
    available: boolean;
    controlAllowed: false;
  };
}

export interface BrowserLeasePolicy {
  tabIds: string[];
  operations: BrowserOperationName[];
}

export interface CreateBrowserLeaseRequest {
  mode: BrowserLeaseMode;
  ttlSeconds?: number;
  tabIds?: string[];
  operations?: BrowserOperationName[];
}

export interface BrowserLeaseRecord {
  id: string;
  sessionId: string;
  mode: BrowserLeaseMode;
  sequence: number;
  processEpoch: number;
  status: BrowserLeaseStatus;
  policy: BrowserLeasePolicy;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export type BrowserLeaseView = Omit<BrowserLeaseRecord, 'tokenHash'>;

export interface IssuedBrowserLease {
  lease: BrowserLeaseView;
  token?: string;
  tokenIssued: boolean;
}

export type BrowserLocatorCandidate =
  | { strategy: 'role'; role: string; name?: string; exact?: boolean }
  | { strategy: 'test_id'; value: string }
  | { strategy: 'label'; value: string; exact?: boolean }
  | { strategy: 'placeholder'; value: string; exact?: boolean }
  | { strategy: 'text'; value: string; exact?: boolean }
  | { strategy: 'css'; value: string }
  | { strategy: 'xpath'; value: string };

export interface BrowserTargetRefV1 {
  semantic: string;
  candidates: BrowserLocatorCandidate[];
  expected: {
    cardinality: 'exactly_one' | 'at_least_one' | 'zero_or_one';
    visible?: boolean;
    enabled?: boolean;
    editable?: boolean;
  };
}

export interface BrowserOperationRequestV1 {
  schema: 'nebula.browser.operation/1.0';
  operationId: string;
  leaseSequence: number;
  deadlineAt: string;
  kind: BrowserOperationKind;
  operation: BrowserOperationName;
  target?: BrowserTargetRefV1;
  args?: Record<string, unknown>;
  capture?: {
    beforeScreenshot?: boolean;
    afterScreenshot?: boolean;
    domSnapshot?: boolean;
    videoSegment?: boolean;
  };
  presentation?: {
    label?: string;
    animation: 'normal' | 'fast' | 'off';
  };
}

export interface ExecuteBrowserOperationInput {
  sessionId: string;
  leaseId: string;
  leaseToken: string;
  tabId?: string;
  request: BrowserOperationRequestV1;
}

export interface ResolvedBrowserTarget {
  semantic: string;
  strategy: BrowserLocatorCandidate['strategy'];
  candidateIndex: number;
  matchedCount: number;
}

export interface BrowserExecutionProblem {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
}

export interface BrowserArtifactRefV1 {
  id: string;
  kind: string;
  sha256: string;
  mimeType: string;
}

export interface BrowserRawArtifact {
  kind: Extract<BrowserArtifactKind, 'screenshot' | 'dom_snapshot'>;
  mimeType: 'image/png' | 'application/json';
  bytes: Buffer;
  snapshotId?: string;
}

export interface BrowserArtifactDownload {
  artifact: BrowserArtifactRecord;
  bytes: Buffer;
}

export type BrowserArtifactKind = 'screenshot' | 'dom_snapshot' | 'video_segment' | 'trace';
export type BrowserArtifactCapturePhase = 'before' | 'after' | 'failure' | 'observation';
export type BrowserArtifactStatus = 'pending' | 'available' | 'failed' | 'expired' | 'deleted';
export type BrowserArtifactCompleteness = 'complete' | 'partial' | 'failed';

export interface BrowserCaptureRecord {
  id: string;
  operationId: string;
  sessionId: string;
  tabId?: string;
  requestHash: string;
  requested: NonNullable<BrowserOperationRequestV1['capture']>;
  status: 'pending' | 'completed' | 'failed';
  completeness: BrowserArtifactCompleteness;
  expectedItemCount: number;
  actualItemCount: number;
  createdAt: string;
  completedAt?: string;
  error?: BrowserExecutionProblem;
}

export interface BrowserArtifactRecord {
  id: string;
  sessionId: string;
  operationId?: string;
  captureId?: string;
  tabId?: string;
  kind: BrowserArtifactKind;
  capturePhase: BrowserArtifactCapturePhase;
  status: BrowserArtifactStatus;
  completeness: BrowserArtifactCompleteness;
  mimeType: string;
  sha256?: string;
  sizeBytes?: number;
  storageBackend: 'local_file' | 'object_ref';
  storageRef?: string;
  redactionStatus: 'not_required' | 'pending' | 'redacted' | 'failed';
  retentionClass: 'volatile' | 'success_7d' | 'failure_30d' | 'upstream_held';
  expiresAt?: string;
  createdAt: string;
  availableAt?: string;
  deletedAt?: string;
  error?: BrowserExecutionProblem;
}

export interface BrowserArtifactHoldRecord {
  id: string;
  artifactId: string;
  ownerService: string;
  ownerRef: string;
  requestHash: string;
  createdAt: string;
  expiresAt?: string;
  releasedAt?: string;
}

export interface BrowserSessionEventRecord {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  entityType: 'session' | 'lease' | 'operation' | 'capture' | 'artifact';
  entityId: string;
  stateVersion?: number;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface BrowserOperationRecord {
  schema: 'nebula.browser.operation-result/1.0';
  operationId: string;
  requestHash: string;
  sessionId: string;
  leaseId: string;
  leaseSequence: number;
  tabId?: string;
  kind: BrowserOperationKind;
  operation: BrowserOperationName;
  status: BrowserOperationStatus;
  queueSequence: number;
  acceptedAt: string;
  startedAt?: string;
  completedAt?: string;
  resolvedTarget?: ResolvedBrowserTarget;
  actual?: unknown;
  artifacts: BrowserArtifactRefV1[];
  error?: BrowserExecutionProblem;
}

export interface BrowserOperationExecutionResult {
  actual?: unknown;
  resolvedTarget?: ResolvedBrowserTarget;
  artifacts?: BrowserArtifactRefV1[];
}

export interface BrowserExecutionCredentials {
  sessionId: string;
  leaseId: string;
  leaseToken: string;
}

export interface BrowserExecutionCapabilities {
  schema: 'nebula.service-capabilities/1.0';
  service: 'proxy-adapter';
  serviceVersion: string;
  protocols: Record<string, { major: number; minor: number }>;
  features: Record<string, boolean | string | number>;
  limits: Record<string, number>;
  generatedAt: string;
}

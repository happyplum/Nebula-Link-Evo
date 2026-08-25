/**
 * Public browser execution wire contracts shared by proxy-adapter consumers.
 * Persistence-only fields and binary artifact bodies intentionally stay local
 * to proxy-adapter.
 */

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

export interface BrowserExecutionProblem {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
}

export interface BrowserSuccessEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    correlationId?: string;
  };
}

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

export interface BrowserLeaseView {
  id: string;
  sessionId: string;
  mode: BrowserLeaseMode;
  sequence: number;
  processEpoch: number;
  status: BrowserLeaseStatus;
  policy: BrowserLeasePolicy;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IssuedBrowserLease {
  lease: BrowserLeaseView;
  token?: string;
  tokenIssued: boolean;
}

export interface BrowserSessionView extends BrowserSessionRecord {
  tabs: BrowserTabSummary[];
  activeLeases: BrowserLeaseView[];
  liveView: {
    available: boolean;
    controlAllowed: false;
  };
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

export type BrowserKeyModifier = 'Alt' | 'Control' | 'Meta' | 'Shift';

export interface BrowserOperationArgsByName {
  page_state: never;
  dom_snapshot: never;
  target_state: never;
  url: never;
  title: never;
  text: never;
  value: never;
  attribute: { name: string };
  count: never;
  tabs: never;
  navigate: { url: string; waitUntil?: 'commit' | 'domcontentloaded' | 'load' };
  click: { button?: 'left' | 'middle' | 'right'; clickCount?: 1 | 2 };
  fill: { value: string };
  type_text: { value: string; delayMs?: number };
  press: { key: string | { key: string; modifiers: BrowserKeyModifier[] } };
  select_option: { values: string[] };
  check: never;
  uncheck: never;
  focus: never;
  blur: never;
  hover: never;
  scroll: { direction: 'up' | 'down' | 'left' | 'right'; amount: number };
  switch_tab: { tabId: string };
  close_tab: { returnToTabId: string };
}

export type BrowserOperationArgs<TOperation extends BrowserOperationName> =
  BrowserOperationArgsByName[TOperation];

type BrowserOperationArgsProperty<TOperation extends BrowserOperationName> =
  BrowserOperationArgs<TOperation> extends never
    ? { args?: never }
    : TOperation extends 'click'
      ? { args?: BrowserOperationArgs<TOperation> }
      : { args: BrowserOperationArgs<TOperation> };

type BrowserOperationDescriptorFor<
  TKind extends BrowserOperationKind,
  TOperation extends BrowserOperationName,
> = TOperation extends BrowserOperationName
  ? { kind: TKind; operation: TOperation } & BrowserOperationArgsProperty<TOperation>
  : never;

export type BrowserOperationDescriptor =
  | BrowserOperationDescriptorFor<'observe', ObserveOperation>
  | BrowserOperationDescriptorFor<'act', ActOperation>;

interface BrowserOperationRequestBaseV1 {
  schema: 'nebula.browser.operation/1.0';
  operationId: string;
  leaseSequence: number;
  deadlineAt: string;
  target?: BrowserTargetRefV1;
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

export type BrowserOperationRequestV1 = BrowserOperationRequestBaseV1 & BrowserOperationDescriptor;

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

export interface BrowserArtifactRefV1 {
  id: string;
  kind: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  snapshotId?: string;
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

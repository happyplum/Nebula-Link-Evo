import type {
  BrowserArtifactRefV1,
  BrowserExecutionProblem,
  BrowserLeaseView,
  BrowserOperationRequestV1,
  ResolvedBrowserTarget,
} from '@nebula-link-evo/shared/types/browser-execution';

export {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
} from '@nebula-link-evo/shared/types/browser-execution';
export type {
  ActOperation,
  BrowserArtifactRefV1,
  BrowserExecutionCapabilities,
  BrowserExecutionCredentials,
  BrowserExecutionProblem,
  BrowserLeaseMode,
  BrowserLeasePolicy,
  BrowserLeaseStatus,
  BrowserLeaseView,
  BrowserLocatorCandidate,
  BrowserOperationKind,
  BrowserOperationName,
  BrowserOperationRecord,
  BrowserOperationRequestV1,
  BrowserOperationStatus,
  BrowserSessionEventRecord,
  BrowserSessionOptions,
  BrowserSessionRecord,
  BrowserSessionStatus,
  BrowserSessionView,
  BrowserTabSummary,
  BrowserTargetRefV1,
  CreateBrowserLeaseRequest,
  ExecuteBrowserOperationInput,
  IssuedBrowserLease,
  ObserveOperation,
  ResolvedBrowserTarget,
} from '@nebula-link-evo/shared/types/browser-execution';

export interface BrowserLeaseRecord extends BrowserLeaseView {
  tokenHash: string;
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

export interface BrowserOperationExecutionResult {
  actual?: unknown;
  resolvedTarget?: ResolvedBrowserTarget;
  artifacts?: BrowserArtifactRefV1[];
}

import type {
  BusinessModuleAsset,
  BusinessVersionDetail,
  FunctionalModuleAsset,
  FunctionalScriptAsset,
  PageAsset,
  ScenarioAsset,
} from './business-version.js';

export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId: string;
    correlationId?: string;
    stateVersion?: number;
  };
}

export interface ApiProblem {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  details?: Record<string, unknown>;
}

export interface ServiceCapabilitiesV1 {
  schema: 'nebula.service-capabilities/1.0';
  service: 'ai-e2e';
  serviceVersion: string;
  protocols: Record<string, { major: number; minor: number }>;
  features: Record<string, boolean | string | number>;
  limits: Record<string, number>;
  generatedAt: string;
}

export interface WorkspacePrdDocumentV1 {
  id: string;
  documentKey: string;
  format: 'markdown' | 'plain_text';
  rawContent: string;
  contentSha256: string;
  parsed?: Record<string, unknown>;
  sourceUri?: string;
  createdAt: string;
}

export interface WorkspaceValidationV1 {
  id: string;
  deploymentRevisionId: string;
  assetGraphSha256: string;
  verificationScopeSha256: string;
  verificationScope: Record<string, unknown>;
  status: 'validating' | 'valid' | 'needs_recheck' | 'invalid';
  validatedAt?: string;
  reason?: Record<string, unknown>;
  createdAt: string;
}

export interface SemanticWorkspaceV1 {
  schema: 'nebula.ai-e2e.workspace/1.0';
  version: BusinessVersionDetail;
  prdDocuments: WorkspacePrdDocumentV1[];
  pages: PageAsset[];
  businessModules: BusinessModuleAsset[];
  functionalModules: FunctionalModuleAsset[];
  functionalScripts: FunctionalScriptAsset[];
  scenarios: ScenarioAsset[];
  validations: WorkspaceValidationV1[];
}

export type SemanticAssetType =
  | 'page_definition'
  | 'business_module'
  | 'functional_module'
  | 'functional_script'
  | 'test_scenario'
  | 'module_requirement'
  | 'page_baseline';

export interface SemanticRevisionV1 {
  id: string;
  assetType: SemanticAssetType;
  assetId: string;
  revisionNo: number;
  lifecycle: 'draft' | 'current' | 'superseded' | 'rejected';
  schemaId: string;
  payload: Record<string, unknown>;
  contentSha256: string;
  validationStatus: 'pending' | 'valid' | 'invalid';
  validationErrors?: unknown[];
  readinessStatus?: 'unverified' | 'verified' | 'stale';
  supersedesRevisionId?: string;
  sourceAssetId?: string;
  sourceRevisionId?: string;
  changeReason: string;
  createdByType: string;
  createdById?: string;
  createdAt: string;
  validatedAt?: string;
  verifications: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
}

export interface SemanticRevisionHistoryV1 {
  schema: 'nebula.ai-e2e.asset-revisions/1.0';
  assetType: SemanticAssetType;
  assetId: string;
  currentRevisionId?: string;
  revisions: SemanticRevisionV1[];
}

export interface SemanticEventV1 {
  id: string;
  seq: number;
  schemaVersion: 1;
  type: string;
  entityType: string;
  entityId: string;
  stateVersion?: number;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface AuthoringSnapshotV1 {
  schema: 'nebula.ai-e2e.authoring-snapshot/1.0';
  job: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  contextThreads: Array<Record<string, unknown>>;
  amendments: Array<Record<string, unknown>>;
  browserJob?: Record<string, unknown>;
  policyEvaluation?: Record<string, unknown>;
  activeApprovalGrant?: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

export interface RunSnapshotV1 {
  schema: 'nebula.ai-e2e.run-snapshot/1.0';
  run: Record<string, unknown>;
  plan?: Record<string, unknown>;
  amendments: Array<Record<string, unknown>>;
  todos: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  pageTasks: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
  browserJob?: Record<string, unknown>;
  policyEvaluation?: Record<string, unknown>;
  activeApprovalGrant?: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

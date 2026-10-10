import type { Static } from '@sinclair/typebox';
import type {
  ApiMetaSchema,
  ApiProblemSchema,
  ServiceCapabilitiesSchema,
  SemanticAssetTypeSchema,
  SemanticEventSchema,
} from './semantic-api.js';
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
  meta: Static<typeof ApiMetaSchema>;
}

export type ApiProblem = Static<typeof ApiProblemSchema>;

export type ServiceCapabilitiesV1 = Static<typeof ServiceCapabilitiesSchema>;

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

export type SemanticAssetType = Static<typeof SemanticAssetTypeSchema>;

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

export type SemanticEventV1 = Static<typeof SemanticEventSchema>;

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

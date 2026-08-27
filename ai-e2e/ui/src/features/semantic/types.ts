export interface ApiSuccess<T> {
  data: T;
  meta: { requestId?: string; stateVersion?: number; correlationId?: string };
}

export interface BusinessVersion {
  id: string;
  projectId: string;
  versionKey: string;
  name: string;
  validationStatus: string;
  schemaVersion: 1;
  deploymentBindings?: Array<{
    bindingKey: string;
    deploymentRevisionId: string;
    isDefault: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticRevision {
  id: string;
  revisionNo: number;
  lifecycle: string;
  schemaId: string;
  contentSha256: string;
  validationStatus: string;
  readinessStatus?: string;
  payload: Record<string, unknown>;
}

export interface PageAsset {
  id: string;
  pageKey: string;
  currentRevision: SemanticRevision;
}

export interface BusinessModuleAsset {
  id: string;
  moduleKey: string;
  currentRevision: SemanticRevision;
}

export interface FunctionalModuleAsset {
  id: string;
  moduleKey: string;
  businessModuleId: string;
  primaryPageDefinitionId: string;
  currentRevision: SemanticRevision;
}

export interface FunctionalScriptAsset {
  id: string;
  scriptKey: string;
  name: string;
  functionalModuleId: string;
  currentRevision: SemanticRevision;
}

export interface ScenarioAsset {
  id: string;
  scenarioKey: string;
  name: string;
  currentRevision: SemanticRevision;
}

export interface PrdDocument {
  id: string;
  documentKey: string;
  rawContent: string;
  sourceUri?: string;
  contentSha256: string;
}

export interface WorkspaceValidation {
  id: string;
  deploymentRevisionId: string;
  status: string;
  verificationScope: Record<string, unknown>;
}

export interface SemanticWorkspace {
  schema: string;
  version: BusinessVersion;
  prdDocuments: PrdDocument[];
  pages: PageAsset[];
  businessModules: BusinessModuleAsset[];
  functionalModules: FunctionalModuleAsset[];
  functionalScripts: FunctionalScriptAsset[];
  scenarios: ScenarioAsset[];
  validations: WorkspaceValidation[];
}

export interface AuthoringAmendment {
  id: string;
  jobId: string;
  threadId: string;
  state: string;
  reason: string;
  category: string;
  impact: Record<string, unknown>;
  validationPlan: Record<string, unknown>;
  decisionIds: string[];
  changes: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  failure?: Record<string, unknown>;
  staleReason?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringSnapshot {
  schema: string;
  job: Record<string, unknown>;
  tasks: Array<Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  contextThreads: Array<Record<string, unknown>>;
  amendments: Array<Record<string, unknown>>;
  browserJob?: Record<string, unknown>;
  seq: number;
  stateVersion: number;
}

export interface RunSnapshot {
  schema: string;
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
  seq: number;
  stateVersion: number;
}

export interface LayoutPreferences {
  leftWidth: number;
  rightWidth: number;
  chatCollapsed: boolean;
  browserFocused: boolean;
  browserCollapsed: boolean;
  browserZoom: number;
  theme: 'system' | 'light' | 'dark';
}

export function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

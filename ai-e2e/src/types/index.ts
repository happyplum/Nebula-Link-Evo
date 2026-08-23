/**
 * AI E2E Types Barrel Export
 *
 * Exports all types, enums, and schemas from the types package.
 */

// ========== ENTITY TYPES ==========
export type {
  Project,
} from './project.js';
export type {
  PRDDocument,
} from './prd-document.js';
export type {
  BusinessModule,
} from './business-module.js';
export type {
  FunctionalModule,
} from './functional-module.js';
export type {
  URL,
  URLModuleBinding,
} from './url.js';
export type {
  TestScenario,
} from './test-scenario.js';
export type {
  Script,
} from './script.js';
export type {
  ExecutionRun,
} from './execution.js';
export type {
  AIInterventionLog,
} from './ai-intervention.js';
export type {
  ExplorationSession,
} from './exploration.js';
export type {
  LoginScript,
  LoginStep,
} from './login-script.js';

// ========== ENUM TYPES ==========
export type {
  ProjectStatus,
} from './project.js';
export type {
  SourceOrigin,
} from './business-module.js';
export type {
  GeneratedValue,
  ScriptStatus,
} from './script.js';
export type {
  BindingStatus,
} from './url.js';
export type {
  ExecutionStatus,
} from './execution.js';
export type {
  ActionTaken,
  FailureType,
} from './ai-intervention.js';
export type {
  ProjectMode,
} from './state-machine.js';

// ========== STATE MACHINE TYPES ==========
export type {
  ModeRequirements,
} from './state-machine.js';
export {
  ProjectMode as ProjectModeValues,
  STATUS_TO_MODE,
  VALID_TRANSITIONS,
  isProjectMode,
  isValidTransition,
  getModeForStatus,
} from './state-machine.js';

// ========== GATE TYPES ==========
export type {
  UnboundModule,
  TransitionErrorResponse,
  DeliverableCheckResult,
} from './gate.js';

// ========== SSE EVENT TYPES ==========
export type {
  SSEEvent,
  SSEEventType,
  BaseSSEEvent,
  ProjectStatusChangedEvent,
  PRDAnalysisProgressEvent,
  PRDAnalysisCompleteEvent,
  ExplorationProgressEvent,
  ExplorationURLFoundEvent,
  ExplorationBindingProposedEvent,
  ExplorationCompleteEvent,
  ScriptGenerationProgressEvent,
  ScriptGeneratedEvent,
  ExecutionStartedEvent,
  ExecutionProgressEvent,
  ExecutionCompletedEvent,
  ExecutionFailedEvent,
  AIDiagnosisEvent,
  AIFixAppliedEvent,
  AIPendingReviewEvent,
  ErrorEvent,
} from './sse-events.js';

// ========== TYPEBOX SCHEMA TYPES ==========
export type {
  ProjectDTO,
  PRDDocumentDTO,
  BusinessModuleDTO,
  FunctionalModuleDTO,
  URLDTO,
  URLModuleBindingDTO,
  TestScenarioDTO,
  ScriptDTO,
  ExecutionRunDTO,
  AIInterventionLogDTO,
  ExplorationSessionDTO,
  LoginScriptDTO,
} from './api.js';

export type {
  AssetReadinessStatus,
  AssetRevision,
  BusinessModuleAsset,
  BusinessVersion,
  BusinessVersionAssetGraph,
  BusinessVersionAssetSummary,
  BusinessVersionDetail,
  BusinessVersionValidationStatus,
  FunctionalModuleAsset,
  FunctionalScriptAsset,
  GitMetadata,
  PageAsset,
  ScenarioAsset,
} from './business-version.js';

export type {
  ApiProblem,
  ApiSuccess,
  AuthoringSnapshotV1,
  RunSnapshotV1,
  SemanticAssetType,
  SemanticEventV1,
  SemanticRevisionHistoryV1,
  SemanticRevisionV1,
  SemanticWorkspaceV1,
  ServiceCapabilitiesV1,
  WorkspacePrdDocumentV1,
  WorkspaceValidationV1,
} from './semantic-control.js';

// ========== ENUM VALUES (CONST OBJECTS) ==========
export {
  ProjectStatus as ProjectStatusValues,
} from './project.js';
export {
  SourceOrigin as SourceOriginValues,
} from './business-module.js';
export {
  GeneratedValue as GeneratedValueValues,
  ScriptStatus as ScriptStatusValues,
} from './script.js';
export {
  BindingStatus as BindingStatusValues,
} from './url.js';
export {
  ExecutionStatus as ExecutionStatusValues,
} from './execution.js';
export {
  ActionTaken as ActionTakenValues,
  FailureType as FailureTypeValues,
} from './ai-intervention.js';

// ========== TYPEBOX SCHEMAS ==========
export {
  ProjectStatusSchema,
  ProjectSchema,
  PRDDocumentSchema,
  SourceOriginSchema,
  BusinessModuleSchema,
  FunctionalModuleSchema,
  BindingStatusSchema,
  URLSchema,
  URLModuleBindingSchema,
  TestScenarioSchema,
  GeneratedValueSchema,
  ScriptStatusSchema,
  ScriptSchema,
  ExecutionStatusSchema,
  ExecutionRunSchema,
  ActionTakenSchema,
  FailureTypeSchema,
  AIInterventionLogSchema,
  ExplorationSessionSchema,
  LoginScriptSchema,
  ProjectModeSchema,
  CreateProjectRequestSchema,
  UpdateProjectRequestSchema,
  ProjectListResponseSchema,
  CreatePRDDocumentRequestSchema,
  CreateBusinessModuleRequestSchema,
  CreateFunctionalModuleRequestSchema,
  UpdateURLModuleBindingRequestSchema,
  CreateTestScenarioRequestSchema,
  UpdateScriptRequestSchema,
  CreateLoginScriptRequestSchema,
  UpdateLoginScriptRequestSchema,
} from './api.js';

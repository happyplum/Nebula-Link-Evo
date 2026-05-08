/**
 * API TypeBox Schemas
 *
 * TypeBox schemas for API request/response validation.
 */

import { Type, Static } from '@sinclair/typebox';
import type {
  Project,
  PRDDocument,
  BusinessModule,
  FunctionalModule,
  URL,
  URLModuleBinding,
  TestScenario,
  Script,
  ExecutionRun,
  AIInterventionLog,
  ExplorationSession,
  LoginScript,
  ProjectStatus,
  SourceOrigin,
  BindingStatus,
  GeneratedValue,
  ScriptStatus,
  ExecutionStatus,
  ActionTaken,
  ProjectMode,
  LoginStep,
} from './index.js';

// ========== COMMON SCHEMAS ==========

export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Array(Type.String())),
  }),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

export const PaginationQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  page_size: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

export type PaginationQuery = Static<typeof PaginationQuerySchema>;

export const IdParamSchema = Type.Object({
  id: Type.String({ description: 'Resource ID' }),
});

export type IdParam = Static<typeof IdParamSchema>;

// ========== PROJECT SCHEMAS ==========

export const ProjectStatusSchema = Type.Union(
  Object.values({
    DRAFT: Type.Literal('draft'),
    CONFIGURING: Type.Literal('configuring'),
    ANALYZING: Type.Literal('analyzing'),
    ANALYZED: Type.Literal('analyzed'),
    EXPLORING: Type.Literal('exploring'),
    EXPLORED: Type.Literal('explored'),
    GENERATING: Type.Literal('generating'),
    READY: Type.Literal('ready'),
    RUNNING: Type.Literal('running'),
    COMPLETED: Type.Literal('completed'),
  })
);

export const ProjectSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  target_base_url: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  status: ProjectStatusSchema,
  tags: Type.Optional(Type.Array(Type.String())),
  login_script_id: Type.Optional(Type.String()),
  created_at: Type.String(),
  updated_at: Type.String(),
  completed_at: Type.Optional(Type.String()),
});

export type ProjectDTO = Static<typeof ProjectSchema>;

// ========== PRD DOCUMENT SCHEMAS ==========

export const PRDDocumentSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  content: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type PRDDocumentDTO = Static<typeof PRDDocumentSchema>;

// ========== BUSINESS MODULE SCHEMAS ==========

export const SourceOriginSchema = Type.Union(
  Object.values({
    AI_GENERATED: Type.Literal('ai_generated'),
    HUMAN_CREATED: Type.Literal('human_created'),
    HUMAN_MODIFIED: Type.Literal('human_modified'),
  })
);

export const BusinessModuleSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  name: Type.String(),
  description: Type.Array(Type.String()),
  requirements: Type.Array(Type.String()),
  source_origin: SourceOriginSchema,
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type BusinessModuleDTO = Static<typeof BusinessModuleSchema>;

// ========== FUNCTIONAL MODULE SCHEMAS ==========

export const FunctionalModuleSchema = Type.Object({
  id: Type.String(),
  business_module_id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type FunctionalModuleDTO = Static<typeof FunctionalModuleSchema>;

// ========== URL SCHEMAS ==========

export const BindingStatusSchema = Type.Union(
  Object.values({
    AI_PROPOSED: Type.Literal('ai_proposed'),
    HUMAN_CONFIRMED: Type.Literal('human_confirmed'),
    HUMAN_MODIFIED: Type.Literal('human_modified'),
    REJECTED: Type.Literal('rejected'),
  })
);

export const URLSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  url: Type.String(),
  path: Type.String(),
  title: Type.Optional(Type.String()),
  created_at: Type.String(),
});

export type URLDTO = Static<typeof URLSchema>;

export const URLModuleBindingSchema = Type.Object({
  id: Type.String(),
  url_id: Type.String(),
  business_module_id: Type.Optional(Type.String()),
  functional_module_id: Type.Optional(Type.String()),
  status: BindingStatusSchema,
  confidence: Type.Optional(Type.Number()),
  notes: Type.Optional(Type.String()),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type URLModuleBindingDTO = Static<typeof URLModuleBindingSchema>;

// ========== TEST SCENARIO SCHEMAS ==========

export const TestScenarioSchema = Type.Object({
  id: Type.String(),
  functional_module_id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  preconditions: Type.Optional(Type.Array(Type.String())),
  expected_results: Type.Optional(Type.Array(Type.String())),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type TestScenarioDTO = Static<typeof TestScenarioSchema>;

// ========== SCRIPT SCHEMAS ==========

export const GeneratedValueSchema = Type.Union(
  Object.values({
    AI_GENERATED: Type.Literal('ai_generated'),
    HUMAN_EDITED: Type.Literal('human_edited'),
    AI_AUTO_FIX: Type.Literal('ai_auto_fix'),
  })
);

export const ScriptStatusSchema = Type.Union(
  Object.values({
    GENERATED: Type.Literal('generated'),
    EDITING: Type.Literal('editing'),
    EDITED: Type.Literal('edited'),
    EXECUTING: Type.Literal('executing'),
    PASSED: Type.Literal('passed'),
    FAILED: Type.Literal('failed'),
    PENDING_REVIEW: Type.Literal('pending_review'),
  })
);

export const ScriptSchema = Type.Object({
  id: Type.String(),
  test_scenario_id: Type.String(),
  name: Type.String(),
  generated_by: GeneratedValueSchema,
  status: ScriptStatusSchema,
  content: Type.Record(Type.String(), Type.Unknown()),
  actions: Type.Array(Type.Unknown()),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type ScriptDTO = Static<typeof ScriptSchema>;

// ========== EXECUTION SCHEMAS ==========

export const ExecutionStatusSchema = Type.Union(
  Object.values({
    RUNNING: Type.Literal('running'),
    PASS: Type.Literal('pass'),
    FAIL: Type.Literal('fail'),
    ERROR: Type.Literal('error'),
    TIMEOUT: Type.Literal('timeout'),
  })
);

export const ExecutionRunSchema = Type.Object({
  id: Type.String(),
  script_id: Type.String(),
  run_number: Type.Number(),
  status: ExecutionStatusSchema,
  started_at: Type.String(),
  ended_at: Type.Optional(Type.String()),
  error_message: Type.Optional(Type.String()),
  result_data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  screenshots: Type.Optional(Type.Array(Type.String())),
  created_at: Type.String(),
});

export type ExecutionRunDTO = Static<typeof ExecutionRunSchema>;

// ========== AI INTERVENTION SCHEMAS ==========

export const ActionTakenSchema = Type.Union(
  Object.values({
    DIAGNOSE_ONLY: Type.Literal('diagnose_only'),
    AUTO_FIX_APPLIED: Type.Literal('auto_fix_applied'),
    PENDING_HUMAN_REVIEW: Type.Literal('pending_human_review'),
    HUMAN_APPROVED: Type.Literal('human_approved'),
    HUMAN_REJECTED: Type.Literal('human_rejected'),
  })
);

export const AIInterventionLogSchema = Type.Object({
  id: Type.String(),
  execution_run_id: Type.String(),
  trigger: Type.String(),
  diagnosis: Type.String(),
  suggested_fix: Type.Optional(Type.String()),
  action_taken: ActionTakenSchema,
  human_feedback: Type.Optional(Type.String()),
  created_at: Type.String(),
});

export type AIInterventionLogDTO = Static<typeof AIInterventionLogSchema>;

// ========== EXPLORATION SESSION SCHEMAS ==========

export const ExplorationSessionSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  start_url: Type.String(),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  pages_visited: Type.Number(),
  total_urls: Type.Number(),
  started_at: Type.String(),
  ended_at: Type.Optional(Type.String()),
  error_message: Type.Optional(Type.String()),
  created_at: Type.String(),
});

export type ExplorationSessionDTO = Static<typeof ExplorationSessionSchema>;

// ========== LOGIN SCRIPT SCHEMAS ==========

const LoginStepSchema = Type.Union([
  Type.Object({
    type: Type.Literal('navigate'),
    description: Type.String(),
    url: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('fill'),
    description: Type.String(),
    selector: Type.String(),
    value: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('click'),
    description: Type.String(),
    selector: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('wait'),
    description: Type.String(),
    duration: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('screenshot'),
    description: Type.String(),
  }),
]);

export const LoginScriptSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  steps: Type.Array(LoginStepSchema),
  is_reusable: Type.Boolean(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

export type LoginScriptDTO = Static<typeof LoginScriptSchema>;

// ========== STATE MACHINE SCHEMAS ==========

export const ProjectModeSchema = Type.Union(
  Object.values({
    CONFIG: Type.Literal('config'),
    ANALYSIS: Type.Literal('analysis'),
    EXPLORATION: Type.Literal('exploration'),
    GENERATION: Type.Literal('generation'),
    EXECUTION: Type.Literal('execution'),
  })
);

// ========== API REQUEST/RESPONSE SCHEMAS ==========

// Project APIs
export const CreateProjectRequestSchema = Type.Object({
  name: Type.String(),
  target_base_url: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  login_script_id: Type.Optional(Type.String()),
});

export const UpdateProjectRequestSchema = Type.Partial(
  Type.Omit(ProjectSchema, ['id', 'created_at', 'updated_at', 'completed_at'])
);

export const ProjectListResponseSchema = Type.Object({
  projects: Type.Array(ProjectSchema),
  total: Type.Number(),
  page: Type.Number(),
  page_size: Type.Number(),
});

// PRD APIs
export const CreatePRDDocumentRequestSchema = Type.Object({
  project_id: Type.String(),
  content: Type.Record(Type.String(), Type.Unknown()),
});

// Module APIs
export const CreateBusinessModuleRequestSchema = Type.Object({
  project_id: Type.String(),
  name: Type.String(),
  description: Type.Array(Type.String()),
  requirements: Type.Array(Type.String()),
  source_origin: SourceOriginSchema,
});

export const CreateFunctionalModuleRequestSchema = Type.Object({
  business_module_id: Type.String(),
  name: Type.String(),
  description: Type.String(),
});

// URL Binding APIs
export const UpdateURLModuleBindingRequestSchema = Type.Partial(
  Type.Omit(URLModuleBindingSchema, [
    'id',
    'url_id',
    'created_at',
    'updated_at',
  ])
);

// Test Scenario APIs
export const CreateTestScenarioRequestSchema = Type.Object({
  functional_module_id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  preconditions: Type.Optional(Type.Array(Type.String())),
  expected_results: Type.Optional(Type.Array(Type.String())),
});

// Script APIs
export const UpdateScriptRequestSchema = Type.Object({
  name: Type.Optional(Type.String()),
  status: Type.Optional(ScriptStatusSchema),
  content: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  actions: Type.Optional(Type.Array(Type.Unknown())),
});

// Login Script APIs
export const CreateLoginScriptRequestSchema = Type.Object({
  name: Type.String(),
  description: Type.Optional(Type.String()),
  steps: Type.Array(LoginStepSchema),
  is_reusable: Type.Boolean(),
});

export const UpdateLoginScriptRequestSchema = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  steps: Type.Optional(Type.Array(LoginStepSchema)),
  is_reusable: Type.Optional(Type.Boolean()),
});

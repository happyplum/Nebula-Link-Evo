/**
 * SSE Event Types
 *
 * Server-Sent Events for AI E2E testing tool.
 * Follows discriminated union pattern with `type` field.
 */

import type {
  Project,
  BusinessModule,
  URL,
  URLModuleBinding,
  Script,
  ExecutionRun,
} from './index.js';
import type { ProjectStatus } from './project.js';

// ========== BASE EVENT TYPE ==========

/**
 * Base SSE event interface with common fields.
 */
export interface BaseSSEEvent {
  /** Event type discriminator */
  type: string;
  /** Event timestamp (ISO string) */
  timestamp: string;
}

// ========== PROJECT EVENTS ==========

/**
 * Project status changed event.
 */
export interface ProjectStatusChangedEvent extends BaseSSEEvent {
  type: 'project.status_changed';
  data: {
    projectId: string;
    oldStatus: ProjectStatus;
    newStatus: ProjectStatus;
  };
}

// ========== PRD ANALYSIS EVENTS ==========

/**
 * PRD analysis progress event.
 */
export interface PRDAnalysisProgressEvent extends BaseSSEEvent {
  type: 'prd.analysis_progress';
  data: {
    projectId: string;
    phase: string;
    progress: number; // 0-100
  };
}

/**
 * PRD analysis complete event.
 */
export interface PRDAnalysisCompleteEvent extends BaseSSEEvent {
  type: 'prd.analysis_complete';
  data: {
    projectId: string;
    modules: BusinessModule[];
  };
}

/**
 * PRD decomposition complete event.
 */
export interface PRDDecompositionCompleteEvent extends BaseSSEEvent {
  type: 'prd.decomposition_complete';
  data: {
    projectId: string;
    businessModuleId: string;
    functionalModules: string[];
  };
}

/**
 * PRD all decompositions complete event.
 */
export interface PRDDecompositionAllCompleteEvent extends BaseSSEEvent {
  type: 'prd.decomposition_all_complete';
  data: {
    projectId: string;
    totalBusinessModules: number;
    succeeded: number;
    failed: number;
  };
}

/**
 * PRD all scenarios generation complete event.
 */
export interface PRDScenariosAllCompleteEvent extends BaseSSEEvent {
  type: 'prd.scenarios_all_complete';
  data: {
    projectId: string;
    succeeded: number;
    failed: number;
  };
}

// ========== EXPLORATION EVENTS ==========

/**
 * Exploration progress event.
 */
export interface ExplorationProgressEvent extends BaseSSEEvent {
  type: 'exploration.progress';
  data: {
    sessionId: string;
    pagesVisited: number;
    urlsFound: number;
  };
}

/**
 * Exploration URL found event.
 */
export interface ExplorationURLFoundEvent extends BaseSSEEvent {
  type: 'exploration.url_found';
  data: {
    url: URL;
  };
}

/**
 * Exploration binding proposed event.
 */
export interface ExplorationBindingProposedEvent extends BaseSSEEvent {
  type: 'exploration.binding_proposed';
  data: {
    binding: URLModuleBinding;
  };
}

/**
 * Exploration complete event.
 */
export interface ExplorationCompleteEvent extends BaseSSEEvent {
  type: 'exploration.complete';
  data: {
    sessionId: string;
    totalUrls: number;
    totalBindings: number;
  };
}

// ========== SCRIPT GENERATION EVENTS ==========

/**
 * Script generation progress event.
 */
export interface ScriptGenerationProgressEvent extends BaseSSEEvent {
  type: 'script.generation_progress';
  data: {
    scenarioId: string;
    progress: number; // 0-100
  };
}

/**
 * Script generated event.
 */
export interface ScriptGeneratedEvent extends BaseSSEEvent {
  type: 'script.generated';
  data: {
    script: Script;
  };
}

// ========== EXECUTION EVENTS ==========

/**
 * Execution started event.
 */
export interface ExecutionStartedEvent extends BaseSSEEvent {
  type: 'execution.started';
  data: {
    runId: string;
    scriptId: string;
  };
}

/**
 * Execution progress event.
 */
export interface ExecutionProgressEvent extends BaseSSEEvent {
  type: 'execution.progress';
  data: {
    runId: string;
    step: string;
  };
}

/**
 * Execution completed event.
 */
export interface ExecutionCompletedEvent extends BaseSSEEvent {
  type: 'execution.completed';
  data: {
    run: ExecutionRun;
  };
}

/**
 * Execution failed event.
 */
export interface ExecutionFailedEvent extends BaseSSEEvent {
  type: 'execution.failed';
  data: {
    runId: string;
    error: string;
  };
}

// ========== AI INTERVENTION EVENTS ==========

/**
 * AI diagnosis event.
 */
export interface AIDiagnosisEvent extends BaseSSEEvent {
  type: 'ai.diagnosis';
  data: {
    runId: string;
    diagnosis: string;
  };
}

/**
 * AI fix applied event.
 */
export interface AIFixAppliedEvent extends BaseSSEEvent {
  type: 'ai.fix_applied';
  data: {
    runId: string;
    scriptId: string;
    diffStats: {
      linesChanged: number;
      totalLines: number;
    };
  };
}

/**
 * AI pending review event.
 */
export interface AIPendingReviewEvent extends BaseSSEEvent {
  type: 'ai.pending_review';
  data: {
    runId: string;
    reason: string;
  };
}

// ========== ERROR EVENT ==========

/**
 * Generic error event.
 */
export interface ErrorEvent extends BaseSSEEvent {
  type: 'error';
  data: {
    message: string;
    code?: string;
  };
}

// ========== SSE EVENT UNION ==========

/**
 * Discriminated union of all SSE event types.
 * Use `type` field for type narrowing.
 */
export type SSEEvent =
  | ProjectStatusChangedEvent
  | PRDAnalysisProgressEvent
  | PRDAnalysisCompleteEvent
  | PRDDecompositionCompleteEvent
  | PRDDecompositionAllCompleteEvent
  | PRDScenariosAllCompleteEvent
  | ExplorationProgressEvent
  | ExplorationURLFoundEvent
  | ExplorationBindingProposedEvent
  | ExplorationCompleteEvent
  | ScriptGenerationProgressEvent
  | ScriptGeneratedEvent
  | ExecutionStartedEvent
  | ExecutionProgressEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | AIDiagnosisEvent
  | AIFixAppliedEvent
  | AIPendingReviewEvent
  | ErrorEvent;

// ========== EVENT TYPE LITERALS ==========

/**
 * All valid event type literals.
 */
export type SSEEventType = SSEEvent['type'];

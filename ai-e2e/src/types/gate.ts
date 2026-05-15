/**
 * Gate Types
 *
 * Strong gate feature types for deliverable validation and error responses.
 */

// ========== UNBOUND MODULE ==========

/**
 * Represents a functional module that has not been bound to any URL.
 * Used in deliverable checks to identify missing URL bindings.
 */
export interface UnboundModule {
  /** Unique identifier of the functional module */
  moduleId: string;
  /** Human-readable name of the functional module */
  moduleName: string;
}

// ========== TRANSITION ERROR RESPONSE ==========

/**
 * Error response returned when a transition is rejected due to unmet deliverables.
 */
export interface TransitionErrorResponse {
  error: {
    /** Error code indicating the reason for transition rejection */
    code: 'DELIVERABLES_NOT_MET';
    /** Human-readable error message */
    message: string;
    /** Detailed list of missing deliverables or issues */
    details: string[];
  };
}

// ========== DELIVERABLE CHECK RESULT ==========

/**
 * Result of a deliverable check before a mode boundary transition.
 */
export interface DeliverableCheckResult {
  /** Whether all required deliverables are met */
  met: boolean;
  /** List of functional modules that are missing required URL bindings */
  missing: UnboundModule[];
}
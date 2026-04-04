/**
 * History feature — typed interfaces for interactions and tasks.
 * Shapes match the backend proxy-adapter REST responses.
 */

/** Single interaction record from GET /debug/api/interactions */
export interface Interaction {
  id: string;
  timestamp: number;
  snapshot_id: string;
  nebula_id: string;
  action_type: string;
  target_type: string;
  locator_strategy: string;
  success: boolean;
  attempts: number;
  latency_ms: number;
  error_code: string | null;
  error_message: string | null;
  failure_sample_path: string | null;
}

/** Aggregated interaction statistics from GET /debug/api/interactions/stats */
export interface InteractionStats {
  total: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_latency_ms: number;
  avg_attempts: number;
  by_action_type: Record<string, number>;
  by_target_type: Record<string, number>;
}

/** Task summary record from GET /debug/api/tasks */
export interface TaskRecord {
  taskId: string;
  url: string;
  instruction: string;
  status: string;
  startTime: string;
  stepCount: number;
}

/** Single step within a task detail */
export interface TaskStep {
  step: number;
  action: { type: string };
  message: string;
  timestamp: string;
  success: boolean;
}

/** Full task detail from GET /debug/api/tasks/:id */
export interface TaskDetail extends TaskRecord {
  endTime: string | null;
  result: string | null;
  error: string | null;
  steps: TaskStep[];
}

/** Failure sample detail from GET /debug/api/failure-sample?path=<path> */
export interface FailureSampleData {
  path: string;
  screenshot: string;
  dom: string;
  context: {
    timestamp: string;
    url: string;
    action: string;
    error: {
      message: string;
      stack?: string;
    };
  };
}

export interface FailureSampleResponse {
  success: boolean;
  data: FailureSampleData | null;
}

/** Local UI filter params for interactions list */
export interface InteractionFilters {
  actionType?: string;
  success?: boolean;
  startTime?: number;
  limit?: number;
  offset?: number;
}

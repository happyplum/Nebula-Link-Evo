/**
 * History feature — query hooks for interactions and tasks.
 * Uses the shared apiClient and endpoint constants.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import {
  DEBUG_INTERACTIONS,
  DEBUG_INTERACTION_STATS,
  DEBUG_FAILURE_SAMPLE,
  DEBUG_TASKS,
  debugTaskDetail,
} from '@/shared/api/endpoints.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import type {
  FailureSampleResponse,
  Interaction,
  InteractionFilters,
  InteractionStats,
  TaskDetail,
  TaskRecord,
} from '../types/index.js';

/** Response envelope for interactions list */
interface InteractionsEnvelope {
  success: boolean;
  data: Interaction[];
}

/** Response envelope for interaction stats */
interface StatsEnvelope {
  success: boolean;
  data: InteractionStats;
}

/** Response envelope for task list */
interface TaskListEnvelope {
  tasks: TaskRecord[];
}

/** Convert InteractionFilters to query params understood by the backend. */
function toQueryParams(filters?: InteractionFilters): Record<string, string> | undefined {
  if (!filters) return undefined;
  const params: Record<string, string> = {};
  if (filters.actionType !== undefined) params.action_type = filters.actionType;
  if (filters.locatorStrategy !== undefined) params.locator_strategy = filters.locatorStrategy;
  if (filters.success !== undefined) params.success = String(filters.success);
  if (filters.startTime !== undefined) params.start_time = String(filters.startTime);
  if (filters.limit !== undefined) params.limit = String(filters.limit);
  if (filters.offset !== undefined) params.offset = String(filters.offset);
  return Object.keys(params).length > 0 ? params : undefined;
}

/** GET /debug/api/interactions — paginated, filterable interaction list. */
export function useInteractions(filters?: InteractionFilters) {
  const params = toQueryParams(filters);
  return useQuery({
    queryKey: queryKeys.interactions.list(params),
    queryFn: () => apiClient.get<InteractionsEnvelope>(DEBUG_INTERACTIONS, params),
  });
}

/** GET /debug/api/interactions/stats — aggregated interaction statistics. */
export function useInteractionStats() {
  return useQuery({
    queryKey: queryKeys.interactions.stats,
    queryFn: () => apiClient.get<StatsEnvelope>(DEBUG_INTERACTION_STATS),
  });
}

/** GET /debug/api/tasks?limit=N — recent task summary list. */
export function useTaskHistory(limit?: number) {
  const params = limit !== undefined ? { limit: String(limit) } : undefined;
  return useQuery({
    queryKey: queryKeys.tasks.list(limit),
    queryFn: () => apiClient.get<TaskListEnvelope>(DEBUG_TASKS, params),
  });
}

/** GET /debug/api/tasks/:id — full task detail with steps. */
export function useTaskDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id),
    queryFn: () => apiClient.get<TaskDetail>(debugTaskDetail(id)),
    enabled: !!id,
  });
}

/** GET /debug/api/failure-sample?path=<path> — failure screenshot, DOM, and error context. */
export function useFailureSample(path: string | null) {
  return useQuery({
    queryKey: queryKeys.interactions.failureSample(path!),
    queryFn: () =>
      apiClient.get<FailureSampleResponse>(DEBUG_FAILURE_SAMPLE, {
        path: path!,
      }),
    enabled: !!path,
    staleTime: 5 * 60 * 1000,
  });
}

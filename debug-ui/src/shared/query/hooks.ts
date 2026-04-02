/**
 * TanStack Query hooks for REST endpoints.
 * Only request-response hooks are defined here — SSE/WS/MJPEG hooks are Phase 2.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import {
  API_CHAT_SESSIONS,
  API_CONFIG,
  API_HEALTH,
  API_TASK,
  DEBUG_INTERACTIONS,
  DEBUG_INTERACTION_STATS,
  DEBUG_MCP_STATUS,
  DEBUG_MCP_TOOLS,
  DEBUG_PLAYWRIGHT_STATUS,
  DEBUG_TASKS,
  apiChatSession,
  apiChatSessionMessages,
  debugTaskDetail,
} from '@/shared/api/endpoints.js';
import { queryKeys } from './query-keys.js';

// Config & Health
export function useConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: () => apiClient.get<ConfigResponse>(API_CONFIG) });
}

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: () => apiClient.get<HealthResponse>(API_HEALTH) });
}

// Task Execution
export function useTaskHistory(limit?: number) {
  const params = limit !== undefined ? { limit: String(limit) } : undefined;
  return useQuery({ queryKey: queryKeys.tasks.list(limit), queryFn: () => apiClient.get<TaskListResponse>(DEBUG_TASKS, params) });
}

export function useTaskDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.tasks.detail(id),
    queryFn: () => apiClient.get<TaskDetailResponse>(debugTaskDetail(id)),
    enabled: !!id,
  });
}

// Chat Sessions
export function useSessions() {
  return useQuery({ queryKey: queryKeys.sessions.all, queryFn: () => apiClient.get<SessionListResponse>(API_CHAT_SESSIONS) });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: queryKeys.sessions.detail(id),
    queryFn: () => apiClient.get<SessionDetailResponse>(apiChatSession(id)),
    enabled: !!id,
  });
}

export function useSessionMessages(id: string) {
  return useQuery({
    queryKey: queryKeys.sessions.messages(id),
    queryFn: () => apiClient.get<SessionMessagesResponse>(apiChatSessionMessages(id)),
    enabled: !!id,
  });
}

// Playwright
export function usePlaywrightStatus() {
  return useQuery({ queryKey: queryKeys.playwright.status, queryFn: () => apiClient.get<PlaywrightStatusResponse>(DEBUG_PLAYWRIGHT_STATUS) });
}

// MCP
export function useMcpStatus() {
  return useQuery({ queryKey: queryKeys.mcp.status, queryFn: () => apiClient.get<McpStatusResponse>(DEBUG_MCP_STATUS) });
}

export function useMcpTools() {
  return useQuery({ queryKey: queryKeys.mcp.tools, queryFn: () => apiClient.get<McpToolsResponse>(DEBUG_MCP_TOOLS) });
}

// Interactions
export function useInteractions(params?: Record<string, string>) {
  return useQuery({ queryKey: queryKeys.interactions.list(params), queryFn: () => apiClient.get<InteractionsResponse>(DEBUG_INTERACTIONS, params) });
}

export function useInteractionStats() {
  return useQuery({ queryKey: queryKeys.interactions.stats, queryFn: () => apiClient.get<InteractionStatsResponse>(DEBUG_INTERACTION_STATS) });
}

// Mutations
export function useExecuteTask() {
  return useMutation({
    mutationFn: (body: { url: string; instruction: string }) => apiClient.post<TaskExecuteResponse>(API_TASK, body),
  });
}

export function useSendChatMessage(sessionId: string) {
  return useMutation({
    mutationFn: (body: { content: string }) => apiClient.post<SendMessageResponse>(apiChatSessionMessages(sessionId), body),
  });
}

// Minimal response type placeholders — will be refined when integrating with shared types
interface ConfigResponse { [key: string]: unknown }
interface HealthResponse { [key: string]: unknown }
interface TaskListResponse { [key: string]: unknown }
interface TaskDetailResponse { [key: string]: unknown }
interface SessionListResponse { [key: string]: unknown }
interface SessionDetailResponse { [key: string]: unknown }
interface SessionMessagesResponse { [key: string]: unknown }
interface PlaywrightStatusResponse { [key: string]: unknown }
interface McpStatusResponse { [key: string]: unknown }
interface McpToolsResponse { [key: string]: unknown }
interface InteractionsResponse { [key: string]: unknown }
interface InteractionStatsResponse { [key: string]: unknown }
interface TaskExecuteResponse { [key: string]: unknown }
interface SendMessageResponse { [key: string]: unknown }

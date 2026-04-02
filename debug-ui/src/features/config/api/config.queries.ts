/**
 * Typed TanStack Query hooks for config, health, and MCP read endpoints.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import {
  API_CONFIG,
  API_HEALTH,
  DEBUG_MCP_STATUS,
  DEBUG_MCP_TOOLS,
  DEBUG_VERIFY_KEYS,
} from '@/shared/api/endpoints.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import type {
  ConfigResponse,
  HealthResponse,
  McpStatusResponse,
  McpToolsResponse,
  VerifyKeysResponse,
} from '../types/index.js';

/** Application config (mode, vision/decision providers) */
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => apiClient.get<ConfigResponse>(API_CONFIG),
  });
}

/** System health (services, MCP, WebSocket connections) */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiClient.get<HealthResponse>(API_HEALTH),
  });
}

/** MCP connection status and server list */
export function useMcpStatus() {
  return useQuery({
    queryKey: queryKeys.mcp.status,
    queryFn: () => apiClient.get<McpStatusResponse>(DEBUG_MCP_STATUS),
  });
}

/** MCP tools discovered from connected servers */
export function useMcpTools() {
  return useQuery({
    queryKey: queryKeys.mcp.tools,
    queryFn: () => apiClient.get<McpToolsResponse>(DEBUG_MCP_TOOLS),
  });
}

/** API key verification status for all providers */
export function useVerifyKeys() {
  return useQuery({
    queryKey: ['verify-keys'] as const,
    queryFn: () => apiClient.get<VerifyKeysResponse>(DEBUG_VERIFY_KEYS),
  });
}

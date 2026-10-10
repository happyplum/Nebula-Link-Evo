/**
 * Typed TanStack Query mutation hooks for MCP call and AI test endpoints.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import { DEBUG_MCP_CALL, DEBUG_TEST_AI } from '@/shared/api/endpoints.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import type { McpCallRequest, McpCallResponse, TestAiResponse } from '../types/index.js';

/** Call an MCP tool on a specific server. Invalidates MCP tools on success. */
export function useMcpCall() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: McpCallRequest) => apiClient.post<McpCallResponse>(DEBUG_MCP_CALL, req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tools });
    },
  });
}

/** Run AI provider connectivity test. */
export function useTestAi() {
  return useMutation({
    mutationFn: () => apiClient.post<TestAiResponse>(DEBUG_TEST_AI),
  });
}

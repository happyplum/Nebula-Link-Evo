/**
 * TanStack Query hooks for REST endpoints.
 * Only request-response hooks are defined here — SSE/WS/MJPEG hooks are Phase 2.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client.js';
import { API_CHAT_SESSIONS } from '@/shared/api/endpoints.js';
import { queryKeys } from './query-keys.js';

// Chat Sessions
export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions.all,
    queryFn: () => apiClient.get<SessionListResponse>(API_CHAT_SESSIONS),
  });
}

// Minimal response type placeholder — will be refined when integrating with shared types
interface SessionListResponse {
  [key: string]: unknown;
}

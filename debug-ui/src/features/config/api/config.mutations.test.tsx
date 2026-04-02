/**
 * Tests for config domain mutation hooks: useMcpCall, useTestAi.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useMcpCall, useTestAi } from './config.mutations.js';

// Mock apiClient for mutation function verification
vi.mock('@/shared/api/client.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { apiClient } from '@/shared/api/client.js';

const mockPost = vi.mocked(apiClient.post);

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('config.mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useMcpCall', () => {
    it('calls MCP tool with server, tool, and args', async () => {
      const response = { success: true, result: { content: 'file contents' } };
      mockPost.mockResolvedValue(response);

      const { result } = renderHook(() => useMcpCall(), { wrapper: createWrapper() });
      result.current.mutate({ server: 'fs-server', tool: 'read_file', args: { path: '/test.txt' } });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockPost).toHaveBeenCalledWith('/debug/api/mcp/call', {
        server: 'fs-server',
        tool: 'read_file',
        args: { path: '/test.txt' },
      });
      expect(result.current.data).toEqual(response);
    });

    it('calls MCP tool without args', async () => {
      const response = { success: true, result: null };
      mockPost.mockResolvedValue(response);

      const { result } = renderHook(() => useMcpCall(), { wrapper: createWrapper() });
      result.current.mutate({ server: 'fs-server', tool: 'list_dir' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockPost).toHaveBeenCalledWith('/debug/api/mcp/call', {
        server: 'fs-server',
        tool: 'list_dir',
      });
    });

    it('handles MCP call error response', async () => {
      const response = { success: false, error: 'Server not running' };
      mockPost.mockResolvedValue(response);

      const { result } = renderHook(() => useMcpCall(), { wrapper: createWrapper() });
      result.current.mutate({ server: 'bad-server', tool: 'test' });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.success).toBe(false);
      expect(result.current.data?.error).toBe('Server not running');
    });

    it('handles API rejection', async () => {
      mockPost.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useMcpCall(), { wrapper: createWrapper() });
      result.current.mutate({ server: 's', tool: 't' });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
    });
  });

  describe('useTestAi', () => {
    it('posts to test-ai endpoint with no body', async () => {
      const response = {
        vision: { status: 'ok', provider: 'openai', model: 'gpt-4o', responseTime: 450, intro: 'Hello' },
        decision: { status: 'ok', provider: 'anthropic', model: 'claude-3', responseTime: 320 },
        totalResponseTime: 770,
      };
      mockPost.mockResolvedValue(response);

      const { result } = renderHook(() => useTestAi(), { wrapper: createWrapper() });
      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockPost).toHaveBeenCalledWith('/debug/api/test-ai');
      expect(result.current.data?.vision?.status).toBe('ok');
      expect(result.current.data?.vision?.provider).toBe('openai');
      expect(result.current.data?.decision?.responseTime).toBe(320);
      expect(result.current.data?.totalResponseTime).toBe(770);
    });

    it('handles partial test results', async () => {
      const response = {
        vision: { status: 'error', error: 'API key not set' },
        totalResponseTime: 100,
      };
      mockPost.mockResolvedValue(response);

      const { result } = renderHook(() => useTestAi(), { wrapper: createWrapper() });
      result.current.mutate();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.vision?.status).toBe('error');
      expect(result.current.data?.vision?.error).toBe('API key not set');
      expect(result.current.data?.decision).toBeUndefined();
    });

    it('handles API rejection', async () => {
      mockPost.mockRejectedValue(new Error('Timeout'));

      const { result } = renderHook(() => useTestAi(), { wrapper: createWrapper() });
      result.current.mutate();

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Timeout');
    });
  });
});

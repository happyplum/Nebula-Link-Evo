/**
 * Tests for config domain query hooks: useConfig, useHealth, useMcpStatus,
 * useMcpTools.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useConfig, useHealth, useMcpStatus, useMcpTools } from './config.queries.js';
import { mustExist } from '@/test-support/must-exist.js';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mockFetchResponse(data: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

// --- Typed mock data ---

const configData = {
  mode: 'hybrid',
  decision: { provider: 'openai', model: 'gpt-4o' },
  providers: ['openai', 'anthropic'],
};

const healthData = {
  status: 'ok',
  config: 'loaded',
  mcp: {
    enabled: true,
    servers: [{ name: 'fs-server', running: true, toolsCount: 3 }],
  },
  services: { playwright: 'running' },
};

const mcpStatusData = {
  enabled: true,
  servers: [
    { name: 'fs-server', running: true, toolsCount: 3 },
    { name: 'web-server', running: false, toolsCount: 0 },
  ],
};

const mcpToolsData = {
  tools: [
    {
      name: 'read_file',
      description: 'Read file contents',
      inputSchema: {
        properties: { path: { type: 'string', description: 'File path' } },
        required: ['path'],
      },
    },
    { name: 'list_dir', description: 'List directory', inputSchema: undefined },
  ],
};

describe('config.queries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('useConfig', () => {
    it('fetches config with typed response', async () => {
      mockFetchResponse(configData);

      const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(configData);
      expect(result.current.data?.providers).toEqual(['openai', 'anthropic']);
    });

    it('handles config with error field', async () => {
      mockFetchResponse({ error: 'Config not loaded' });

      const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.error).toBe('Config not loaded');
    });

    it('uses correct query key', async () => {
      mockFetchResponse(configData);

      const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify the endpoint was called
      expect(fetch).toHaveBeenCalledWith('/api/v1/config', { signal: expect.any(AbortSignal) });
    });
  });

  describe('useHealth', () => {
    it('fetches health with full typed response', async () => {
      mockFetchResponse(healthData);

      const { result } = renderHook(() => useHealth(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const data = mustExist(result.current.data, 'health response');
      expect(data.status).toBe('ok');
      expect(data.mcp.enabled).toBe(true);
      expect(data.mcp.servers).toHaveLength(1);
      expect(data.mcp.servers[0].toolsCount).toBe(3);
      expect(data.services.playwright).toBe('running');
    });

    it('fetches /api/v1/health endpoint', async () => {
      mockFetchResponse(healthData);

      renderHook(() => useHealth(), { wrapper: createWrapper() });
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith('/api/v1/health', { signal: expect.any(AbortSignal) })
      );
    });
  });

  describe('useMcpStatus', () => {
    it('fetches MCP status with server list', async () => {
      mockFetchResponse(mcpStatusData);

      const { result } = renderHook(() => useMcpStatus(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const data = mustExist(result.current.data, 'MCP status response');
      expect(data.enabled).toBe(true);
      expect(data.servers).toHaveLength(2);
      expect(data.servers[0].running).toBe(true);
      expect(data.servers[1].running).toBe(false);
      expect(data.servers[1].toolsCount).toBe(0);
    });

    it('fetches /debug/api/mcp/status endpoint', async () => {
      mockFetchResponse(mcpStatusData);

      renderHook(() => useMcpStatus(), { wrapper: createWrapper() });
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith('/debug/api/mcp/status', {
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('useMcpTools', () => {
    it('fetches MCP tools with schema', async () => {
      mockFetchResponse(mcpToolsData);

      const { result } = renderHook(() => useMcpTools(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const tools = mustExist(result.current.data, 'MCP tools response').tools;
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('read_file');
      expect(tools[0].inputSchema?.required).toEqual(['path']);
      expect(tools[0].inputSchema?.properties?.path?.type).toBe('string');
    });

    it('handles tools without inputSchema', async () => {
      mockFetchResponse({ tools: [{ name: 'ping', description: 'Ping' }] });

      const { result } = renderHook(() => useMcpTools(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(
        mustExist(result.current.data, 'MCP tools response').tools[0].inputSchema
      ).toBeUndefined();
    });

    it('fetches /debug/api/mcp/tools endpoint', async () => {
      mockFetchResponse(mcpToolsData);

      renderHook(() => useMcpTools(), { wrapper: createWrapper() });
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith('/debug/api/mcp/tools', {
          signal: expect.any(AbortSignal),
        })
      );
    });
  });

  describe('error handling', () => {
    it('surfaces fetch errors for useConfig', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'fail' }), { status: 500 })
      );

      const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
    });

    it('surfaces fetch errors for useHealth', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      const { result } = renderHook(() => useHealth(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });
});

/**
 * Tests verifying query hooks exist, are functions, and work with mocked fetch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  useConfig,
  useHealth,
  useTaskHistory,
  useTaskDetail,
  useSessions,
  useSession,
  useSessionMessages,
  usePlaywrightStatus,
  useMcpStatus,
  useMcpTools,
  useInteractions,
  useInteractionStats,
  useExecuteTask,
  useSendChatMessage,
} from '../hooks.js';

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('Query hooks — existence and basic behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should export all query hooks as functions', () => {
    const queryHooks = [useConfig, useHealth, useTaskHistory, useTaskDetail, useSessions, useSession, useSessionMessages, usePlaywrightStatus, useMcpStatus, useMcpTools, useInteractions, useInteractionStats];
    queryHooks.forEach((hook) => {
      expect(typeof hook).toBe('function');
    });
  });

  it('should export mutation hooks as functions', () => {
    expect(typeof useExecuteTask).toBe('function');
    expect(typeof useSendChatMessage).toBe('function');
  });

  it('useConfig should fetch /api/config', async () => {
    const mockData = { mode: 'test', providers: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mockData), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const { result } = renderHook(() => useConfig(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
  });

  it('useHealth should fetch /api/health', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const { result } = renderHook(() => useHealth(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ status: 'ok' });
  });

  it('useTaskHistory should fetch /debug/api/tasks with limit param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const { result } = renderHook(() => useTaskHistory(10), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/debug/api/tasks?limit=10');
  });

  it('useTaskDetail should not fetch when id is empty', () => {
    vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useTaskDetail(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('useExecuteTask should POST to /api/task', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ taskId: 't1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const { result } = renderHook(() => useExecuteTask(), { wrapper: createWrapper() });
    result.current.mutate({ url: 'https://example.com', instruction: 'click' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ taskId: 't1' });
  });
});

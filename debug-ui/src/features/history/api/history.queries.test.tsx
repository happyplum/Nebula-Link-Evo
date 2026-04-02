/**
 * Tests for history query hooks and interaction filter hook.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  useInteractions,
  useInteractionStats,
  useTaskHistory,
  useTaskDetail,
} from '../api/history.queries.js';
import { useInteractionFilters } from '../hooks/useInteractionFilters.js';

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function mockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useInteractions', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('fetches interactions without filters', async () => {
    const data = { success: true, data: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(data));

    const { result } = renderHook(() => useInteractions(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
  });

  it('sends filter params as query string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

    renderHook(() => useInteractions({ actionType: 'click', success: true, limit: 10 }), { wrapper: createWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('action_type=click');
    expect(calledUrl).toContain('success=true');
    expect(calledUrl).toContain('limit=10');
  });

  it('sends offset param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

    renderHook(() => useInteractions({ offset: 50 }), { wrapper: createWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('offset=50');
  });
});

describe('useInteractionStats', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('fetches stats from /debug/api/interactions/stats', async () => {
    const stats = { success: true, data: { total: 100, success_count: 90, failure_count: 10, success_rate: 0.9, avg_latency_ms: 150, avg_attempts: 1.2, by_action_type: {}, by_target_type: {} } };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(stats));

    const { result } = renderHook(() => useInteractionStats(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.data.total).toBe(100);
  });
});

describe('useTaskHistory', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('fetches tasks without limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ tasks: [] }));

    const { result } = renderHook(() => useTaskHistory(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ tasks: [] });
  });

  it('sends limit as query param', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ tasks: [] }));

    renderHook(() => useTaskHistory(25), { wrapper: createWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('limit=25'));
  });
});

describe('useTaskDetail', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does not fetch when id is empty', () => {
    vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useTaskDetail(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches task detail when id is provided', async () => {
    const detail = { taskId: 't1', url: 'https://example.com', instruction: 'click', status: 'completed', startTime: '2025-01-01T00:00:00Z', stepCount: 3, endTime: null, result: null, error: null, steps: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(detail));

    const { result } = renderHook(() => useTaskDetail('t1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.taskId).toBe('t1');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/debug/api/tasks/t1'));
  });
});

describe('useInteractionFilters', () => {
  it('initializes with default filters', () => {
    const { result } = renderHook(() => useInteractionFilters());
    expect(result.current.filters).toEqual({ limit: 50, offset: 0 });
  });

  it('merges initial overrides', () => {
    const { result } = renderHook(() => useInteractionFilters({ actionType: 'click' }));
    expect(result.current.filters.actionType).toBe('click');
    expect(result.current.filters.limit).toBe(50);
  });

  it('updates filters via patch', () => {
    const { result } = renderHook(() => useInteractionFilters());
    act(() => { result.current.updateFilters({ actionType: 'type', success: false }); });
    expect(result.current.filters.actionType).toBe('type');
    expect(result.current.filters.success).toBe(false);
    expect(result.current.filters.limit).toBe(50);
  });

  it('resets to defaults', () => {
    const { result } = renderHook(() => useInteractionFilters());
    act(() => { result.current.updateFilters({ actionType: 'scroll', offset: 100 }); });
    expect(result.current.filters.actionType).toBe('scroll');

    act(() => { result.current.resetFilters(); });
    expect(result.current.filters).toEqual({ limit: 50, offset: 0 });
  });
});

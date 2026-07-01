import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRecentRuns } from './useRecentRuns.js';
import type { ExecutionRun } from '../store/executionApi.js';

// Mock projectApi to return a fixed list of projects
vi.mock('../../project/store/projectApi.js', () => ({
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'P1' },
      { id: 'p2', name: 'P2' },
    ],
  }),
}));

// Mock executionApi: fetchRuns returns project-specific runs; executionKeys stable
const runsByProject: Record<string, ExecutionRun[]> = {
  p1: [
    {
      id: 'r1',
      script_id: 's1',
      script_name: '登录',
      status: 'pass',
      started_at: '2026-07-01T10:00:00Z',
      completed_at: '2026-07-01T10:01:00Z',
      duration_ms: 60000,
      error_message: null,
    },
    {
      id: 'r2',
      script_id: 's2',
      script_name: '下单',
      status: 'fail',
      started_at: '2026-07-01T12:00:00Z',
      completed_at: '2026-07-01T12:00:30Z',
      duration_ms: 30000,
      error_message: 'timeout',
    },
  ],
  p2: [
    {
      id: 'r3',
      script_id: 's3',
      script_name: '注册',
      status: 'error',
      started_at: '2026-07-01T11:00:00Z',
      completed_at: '2026-07-01T11:00:10Z',
      duration_ms: 10000,
      error_message: 'boom',
    },
  ],
};

vi.mock('../store/executionApi.js', () => ({
  executionKeys: {
    all: (pid: string) => ['execution', pid] as const,
    runs: (pid: string) => ['execution', pid, 'runs'] as const,
    runDetail: (pid: string, rid: string) => ['execution', pid, 'runs', rid] as const,
    diagnosis: (pid: string, rid: string) => ['execution', pid, 'runs', rid, 'diagnosis'] as const,
  },
  fetchRuns: vi.fn((pid: string) => Promise.resolve(runsByProject[pid] ?? [])),
}));

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useRecentRuns', () => {
  it('aggregates runs across projects sorted by started_at desc and limits', async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useRecentRuns(5), { wrapper: makeWrapper(client) });

    // Wait for queries to resolve
    await vi.waitFor(() => {
      expect(result.current.runs.length).toBe(3);
    });

    const runs = result.current.runs;
    // Sorted by started_at desc: r2(12:00) > r3(11:00) > r1(10:00)
    expect(runs[0].id).toBe('r2');
    expect(runs[1].id).toBe('r3');
    expect(runs[2].id).toBe('r1');
  });

  it('respects the limit parameter', async () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useRecentRuns(2), { wrapper: makeWrapper(client) });

    await vi.waitFor(() => {
      expect(result.current.runs.length).toBe(2);
    });
    expect(result.current.runs[0].id).toBe('r2');
    expect(result.current.runs[1].id).toBe('r3');
  });
});

import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { useAgentWorkflow } from './useAgentWorkflow.js';
import { useAgentStore } from '../store/agentStore.js';

vi.mock('../../analysis/store/analysisApi.js', () => ({
  useUploadPRD: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useAnalyzePRD: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useTransitionState: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../exploration/store/explorationApi.js', () => ({
  useStartExploration: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useExplorationStatus: () => ({
    data: { status: 'idle', pages_visited: 0, urls_found: 2 },
    isLoading: false,
  }),
}));

vi.mock('../../scripts/store/scriptsApi.js', () => ({
  useGenerateScripts: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));

vi.mock('../../execution/store/executionApi.js', () => ({
  useRunAllScripts: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useRuns: () => ({
    data: [{ id: 'r1', status: 'running', started_at: new Date().toISOString() }],
  }),
}));

vi.mock('../../../hooks/use-sse.js', () => ({
  useSSE: () => {},
}));

const makeWrapper = (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe('useAgentWorkflow', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages();
    useAgentStore.getState().setPhase('idle');
  });

  it('adds user message and starts analyzing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAgentWorkflow('p1'), { wrapper: makeWrapper(client) });

    act(() => {
      result.current.send('test login flow');
    });

    await waitFor(() => expect(useAgentStore.getState().messages[0].role).toBe('user'));
    await waitFor(() => expect(useAgentStore.getState().phase).toBe('analyzing'));
  });

  it('presents exploration action after analysis and transitions to exploring', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAgentWorkflow('p1'), { wrapper: makeWrapper(client) });

    await act(async () => {
      result.current.send('test login flow');
    });

    await waitFor(() => {
      const agentMessages = useAgentStore.getState().messages.filter((m) => m.role === 'agent');
      const last = agentMessages[agentMessages.length - 1];
      return last !== undefined && (last.actions?.length ?? 0) > 0;
    });

    const agentMessages = useAgentStore.getState().messages.filter((m) => m.role === 'agent');
    const lastAgent = agentMessages[agentMessages.length - 1]!;

    await act(async () => {
      await lastAgent.actions![0].onClick();
    });

    await waitFor(() => expect(useAgentStore.getState().phase).toBe('exploring'));
  });
});

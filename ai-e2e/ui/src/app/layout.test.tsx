import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './layout.js';
import { useAgentStore } from '../features/agent/store/agentStore.js';

// useAgentWorkflow pulls in react-query mutation hooks; mock it so the layout
// test only verifies the floating-button → AgentChat wiring.
vi.mock('../features/agent/hooks/useAgentWorkflow.js', () => ({
  useAgentWorkflow: () => ({ send: vi.fn(), isRunning: false, currentPhase: 'idle' }),
}));

// Avoid network/SSE noise in jsdom: project queries return empty and SSE is a no-op.
vi.mock('../features/project/store/projectApi.js', () => ({
  useProjects: () => ({ data: [] }),
  useProject: () => ({ data: undefined }),
  projectKeys: { detail: () => ['project', 'detail'], lists: () => ['project', 'lists'] },
}));

describe('Layout agent entry', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages();
    useAgentStore.getState().setOpen(false);
  });

  it('opens agent chat when floating button is clicked', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/project/p1']}>
          <Routes>
            <Route path="/project/:projectId" element={<Layout />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByLabelText('打开 AI 测试助手'));
    expect(screen.getByPlaceholderText('输入指令...')).toBeInTheDocument();
  });
});

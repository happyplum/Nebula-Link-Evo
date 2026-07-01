import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentEntry } from './AgentEntry.js';
import { useAgentStore } from '../store/agentStore.js';

// useAgentWorkflow pulls in many react-query mutation hooks; mock it so the
// test stays focused on the entry's open/close wiring.
vi.mock('../hooks/useAgentWorkflow.js', () => ({
  useAgentWorkflow: () => ({ send: vi.fn(), isRunning: false, currentPhase: 'idle' }),
}));

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/project/:projectId" element={<AgentEntry />} />
          <Route path="/" element={<AgentEntry />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentEntry', () => {
  beforeEach(() => {
    useAgentStore.getState().clearMessages();
    useAgentStore.getState().setOpen(false);
  });

  it('renders the floating button inside /project/:projectId route', () => {
    renderAt('/project/p1');
    expect(screen.getByLabelText('打开 AI 测试助手')).toBeInTheDocument();
  });

  it('returns null on /', () => {
    const { container } = renderAt('/');
    expect(container).toBeEmptyDOMElement();
  });

  it('opens AgentChat when the floating button is clicked', () => {
    renderAt('/project/p1');
    fireEvent.click(screen.getByLabelText('打开 AI 测试助手'));
    expect(screen.getByPlaceholderText('输入指令...')).toBeInTheDocument();
  });
});

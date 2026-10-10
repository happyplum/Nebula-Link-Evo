import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HomePage } from './HomePage.js';

// Mock projectApi: empty projects keeps useRecentRuns quiet, and
// useCreateProject stub satisfies CreateProjectDialog.
vi.mock('../../features/project/store/projectApi.js', () => ({
  useProjects: () => ({ data: [], isLoading: false, error: null }),
  useCreateProject: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('HomePage', () => {
  it('renders the semantic workspace entry', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Semantic E2E 工作台')).toBeInTheDocument();
    expect(screen.getByText(/从 PRD 到可见浏览器执行/)).toBeInTheDocument();
  });

  it('renders the three metric cards', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Semantic 项目')).toBeInTheDocument();
    expect(screen.getByText('已验证版本')).toBeInTheDocument();
    expect(screen.getByText('需要处理')).toBeInTheDocument();
  });

  it('renders the semantic project create button', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('创建项目并开始编排')).toBeInTheDocument();
  });
});

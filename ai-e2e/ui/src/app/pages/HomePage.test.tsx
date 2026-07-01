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
  it('renders dashboard title and subtitle', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('工作区')).toBeInTheDocument();
    expect(screen.getByText('管理并运行你的 AI E2E 测试')).toBeInTheDocument();
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
    expect(screen.getByText('项目数')).toBeInTheDocument();
    expect(screen.getByText('通过次数')).toBeInTheDocument();
    expect(screen.getByText('失败次数')).toBeInTheDocument();
  });

  it('renders the QuickActions create button', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('新建测试项目')).toBeInTheDocument();
  });
});

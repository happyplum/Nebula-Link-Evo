import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectList } from './ProjectList.js';

vi.mock('../store/projectApi.js', () => ({
  useProjects: () => ({ data: [], isLoading: false }),
  useCreateProject: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectList', () => {
  it('calls onCreateProject when provided and primary CTA is clicked', () => {
    const onCreate = vi.fn();
    renderWithProviders(<ProjectList onCreateProject={onCreate} />);
    // Both the header CTA and empty-state button say "新建项目"
    fireEvent.click(screen.getAllByText('新建项目')[0]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onCreateProject from the empty-state button', () => {
    const onCreate = vi.fn();
    renderWithProviders(<ProjectList onCreateProject={onCreate} />);
    const buttons = screen.getAllByText('新建项目');
    // The last one is the empty-state CTA
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders the create dialog when onCreateProject is absent', () => {
    renderWithProviders(<ProjectList />);
    // Click the standalone button → dialog should open
    fireEvent.click(screen.getAllByText('新建项目')[0]);
    // CreateProjectDialog exposes a name input unique to the modal
    expect(screen.getByPlaceholderText('例如：订单中心')).toBeInTheDocument();
  });
});

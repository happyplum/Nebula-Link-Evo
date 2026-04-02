import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InteractionsTable } from './InteractionsTable.js';
import { useInteractions } from '../api/history.queries.js';
import { useInteractionFilters } from '../hooks/useInteractionFilters.js';

vi.mock('../api/history.queries.js', () => ({
  useInteractions: vi.fn(),
}));

vi.mock('../hooks/useInteractionFilters.js', () => ({
  useInteractionFilters: vi.fn(),
}));

const mockInteractions = [
  {
    id: 'int-1',
    timestamp: 1711929600000,
    snapshot_id: 'snap-1',
    nebula_id: 'neb-1',
    action_type: 'click',
    target_type: 'button',
    locator_strategy: 'css',
    success: true,
    attempts: 1,
    latency_ms: 150,
    error_code: null,
    error_message: null,
    failure_sample_path: null,
  },
  {
    id: 'int-2',
    timestamp: 1711929660000,
    snapshot_id: 'snap-2',
    nebula_id: 'neb-2',
    action_type: 'type',
    target_type: 'input',
    locator_strategy: 'xpath',
    success: false,
    attempts: 2,
    latency_ms: 500,
    error_code: 'TIMEOUT',
    error_message: 'Element not found',
    failure_sample_path: null,
  },
];

describe('InteractionsTable', () => {
  const mockUpdateFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useInteractionFilters).mockReturnValue({
      filters: {},
      updateFilters: mockUpdateFilters,
      resetFilters: vi.fn(),
    });
  });

  it('renders loading state', () => {
    vi.mocked(useInteractions).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<InteractionsTable />);
    expect(screen.getByText('Loading interactions...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useInteractions).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
    } as any);

    render(<InteractionsTable />);
    expect(screen.getByText('Failed to load interactions')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(useInteractions).mockReturnValue({
      data: { success: true, data: [] },
      isLoading: false,
      error: null,
    } as any);

    render(<InteractionsTable />);
    expect(screen.getByText('No interactions found')).toBeInTheDocument();
  });

  it('renders interactions and handles filters', () => {
    vi.mocked(useInteractions).mockReturnValue({
      data: { success: true, data: mockInteractions },
      isLoading: false,
      error: null,
    } as any);

    render(<InteractionsTable />);
    
    expect(screen.getByTestId('interactions-table')).toBeInTheDocument();
    
    // Check content
    expect(screen.getByText('click')).toBeInTheDocument();
    expect(screen.getByText('type')).toBeInTheDocument();
    expect(screen.getByText('button')).toBeInTheDocument();
    expect(screen.getByText('input')).toBeInTheDocument();
    expect(screen.getAllByText('Success')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Failed')[0]).toBeInTheDocument();
    
    // Test filters
    const actionFilter = screen.getByTestId('interaction-filter-action-type');
    fireEvent.change(actionFilter, { target: { value: 'click' } });
    expect(mockUpdateFilters).toHaveBeenCalledWith({ actionType: 'click' });

    const successFilter = screen.getByTestId('interaction-filter-success');
    fireEvent.change(successFilter, { target: { value: 'true' } });
    expect(mockUpdateFilters).toHaveBeenCalledWith({ success: true });
  });

  it('opens modal on row click', () => {
    vi.mocked(useInteractions).mockReturnValue({
      data: { success: true, data: mockInteractions },
      isLoading: false,
      error: null,
    } as any);

    render(<InteractionsTable />);
    
    const rows = screen.getAllByTestId('interactions-table-row');
    fireEvent.click(rows[0]);
    
    expect(screen.getByTestId('interaction-detail-modal')).toBeInTheDocument();
    expect(screen.getByText('int-1')).toBeInTheDocument();
  });
});

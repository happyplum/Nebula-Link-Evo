import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InteractionsTable } from './InteractionsTable.js';

vi.mock('./FailureSampleModal.js', () => ({
  FailureSampleModal: () => null,
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
  const renderWithQuery = (ui: React.ReactElement) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  };

  it('renders loading state', () => {
    renderWithQuery(<InteractionsTable interactions={[]} isLoading={true} error={null} />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    renderWithQuery(<InteractionsTable interactions={[]} isLoading={false} error={new Error('Failed')} />);
    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    renderWithQuery(<InteractionsTable interactions={[]} isLoading={false} error={null} />);
    expect(screen.getByText('暂无交互记录')).toBeInTheDocument();
  });

  it('renders interactions table with data', () => {
    renderWithQuery(<InteractionsTable interactions={mockInteractions} isLoading={false} error={null} />);

    expect(screen.getByTestId('interactions-table')).toBeInTheDocument();

    expect(screen.getByText('click')).toBeInTheDocument();
    expect(screen.getByText('type')).toBeInTheDocument();
    expect(screen.getByText('button')).toBeInTheDocument();
    expect(screen.getByText('input')).toBeInTheDocument();
    expect(screen.getAllByText('成功')[0]).toBeInTheDocument();
    expect(screen.getAllByText('失败')[0]).toBeInTheDocument();
  });

  it('opens modal on row click', () => {
    renderWithQuery(<InteractionsTable interactions={mockInteractions} isLoading={false} error={null} />);

    const rows = screen.getAllByTestId('interactions-table-row');
    fireEvent.click(rows[0]);

    expect(screen.getByTestId('interaction-detail-modal')).toBeInTheDocument();
    expect(screen.getByText('int-1')).toBeInTheDocument();
  });
});

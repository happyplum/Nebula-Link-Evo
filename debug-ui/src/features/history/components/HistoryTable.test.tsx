import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HistoryTable } from './HistoryTable.js';
import { useTaskHistory } from '../api/history.queries.js';

vi.mock('../api/history.queries.js', () => ({
  useTaskHistory: vi.fn(),
  useTaskDetail: vi.fn().mockReturnValue({ data: undefined, isLoading: false, error: null }),
}));

const mockTasks = [
  {
    taskId: 'task-1',
    url: 'https://example.com',
    instruction: 'This is a very long instruction that should be truncated because it exceeds fifty characters in length',
    status: 'completed',
    startTime: '2024-03-31T12:00:00Z',
    stepCount: 5,
  },
  {
    taskId: 'task-2',
    url: 'https://example.com',
    instruction: 'Short instruction',
    status: 'failed',
    startTime: '2024-03-31T12:05:00Z',
    stepCount: 2,
  },
];

describe('HistoryTable', () => {
  it('renders loading state', () => {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<HistoryTable />);
    expect(screen.getByText('Loading history...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
    } as any);

    render(<HistoryTable />);
    expect(screen.getByText('Failed to load history')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: { tasks: [] },
      isLoading: false,
      error: null,
    } as any);

    render(<HistoryTable />);
    expect(screen.getByText('No tasks found')).toBeInTheDocument();
  });

  it('renders tasks and truncates long instructions', () => {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: { tasks: mockTasks },
      isLoading: false,
      error: null,
    } as any);

    render(<HistoryTable />);
    
    expect(screen.getByTestId('history-table')).toBeInTheDocument();
    
    // Truncated instruction
    expect(screen.getByText('This is a very long instruction that should be tru...')).toBeInTheDocument();
    
    // Short instruction
    expect(screen.getByText('Short instruction')).toBeInTheDocument();
    
    // Statuses
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    
    // Step counts
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens modal on row click', () => {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: { tasks: mockTasks },
      isLoading: false,
      error: null,
    } as any);

    render(<HistoryTable />);
    
    const rows = screen.getAllByTestId('history-table-row');
    fireEvent.click(rows[0]);
    
    // Modal should be open (we mocked useTaskDetail to return empty, but the modal container should be there)
    expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TaskDetailModal } from './TaskDetailModal.js';
import { useTaskDetail } from '../api/history.queries.js';

vi.mock('../api/history.queries.js', () => ({
  useTaskDetail: vi.fn(),
}));

const mockTask = {
  taskId: 'task-123',
  url: 'https://example.com',
  instruction: 'Click the button',
  status: 'completed',
  startTime: '2024-03-31T12:00:00Z',
  endTime: '2024-03-31T12:01:00Z',
  stepCount: 1,
  result: 'Success',
  error: null,
  steps: [
    {
      step: 1,
      action: { type: 'click' },
      message: 'Clicked button',
      timestamp: '2024-03-31T12:00:30Z',
      success: true,
    },
  ],
};

describe('TaskDetailModal', () => {
  it('renders nothing when taskId is null', () => {
    vi.mocked(useTaskDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any);

    const { container } = render(
      <TaskDetailModal taskId={null} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders loading state', () => {
    vi.mocked(useTaskDetail).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<TaskDetailModal taskId="task-123" onClose={vi.fn()} />);
    expect(screen.getByText('Loading task details...')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useTaskDetail).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
    } as any);

    render(<TaskDetailModal taskId="task-123" onClose={vi.fn()} />);
    expect(screen.getByText('Failed to load task details')).toBeInTheDocument();
  });

  it('renders task details', () => {
    vi.mocked(useTaskDetail).mockReturnValue({
      data: mockTask,
      isLoading: false,
      error: null,
    } as any);

    render(<TaskDetailModal taskId="task-123" onClose={vi.fn()} />);
    
    expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
    expect(screen.getByText('task-123')).toBeInTheDocument();
    expect(screen.getByText('Click the button')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('click')).toBeInTheDocument();
    expect(screen.getByText('Clicked button')).toBeInTheDocument();
  });
});

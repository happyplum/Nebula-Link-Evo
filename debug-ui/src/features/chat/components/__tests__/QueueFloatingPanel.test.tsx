import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueueFloatingPanel } from '../QueueFloatingPanel.js';
import type { PendingJobInfo } from '@nebula-link-evo/shared';

describe('QueueFloatingPanel', () => {
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders null when pendingJobs is empty array', () => {
    const { container } = render(
      <QueueFloatingPanel pendingJobs={[]} onCancel={mockOnCancel} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders correct number of job items', () => {
    const jobs: PendingJobInfo[] = [
      { jobId: '1', sessionId: 's1', messageId: 'm1', contentPreview: 'Job 1', createdAt: '2026-06-03T00:00:00Z', status: 'queued' },
      { jobId: '2', sessionId: 's1', messageId: 'm2', contentPreview: 'Job 2', createdAt: '2026-06-03T00:01:00Z', status: 'running' },
    ];

    render(<QueueFloatingPanel pendingJobs={jobs} onCancel={mockOnCancel} />);
    
    const items = screen.getAllByTestId('queue-job-item');
    expect(items).toHaveLength(2);
  });

  it('shows contentPreview text for each job', () => {
    const jobs: PendingJobInfo[] = [
      { jobId: '1', sessionId: 's1', messageId: 'm1', contentPreview: 'First job preview', createdAt: '2026-06-03T00:00:00Z', status: 'queued' },
    ];

    render(<QueueFloatingPanel pendingJobs={jobs} onCancel={mockOnCancel} />);
    
    expect(screen.getByText('First job preview')).toBeInTheDocument();
  });

  it('shows yellow dot for queued status, green dot for running status', () => {
    const jobs: PendingJobInfo[] = [
      { jobId: '1', sessionId: 's1', messageId: 'm1', contentPreview: 'Job 1', createdAt: '2026-06-03T00:00:00Z', status: 'queued' },
      { jobId: '2', sessionId: 's1', messageId: 'm2', contentPreview: 'Job 2', createdAt: '2026-06-03T00:01:00Z', status: 'running' },
    ];

    render(<QueueFloatingPanel pendingJobs={jobs} onCancel={mockOnCancel} />);
    
    const queuedDot = screen.getByTestId('status-dot-1');
    const runningDot = screen.getByTestId('status-dot-2');

    expect(queuedDot).toHaveAttribute('data-status', 'queued');
    expect(runningDot).toHaveAttribute('data-status', 'running');
  });

  it('cancel button present for queued jobs, absent for running jobs', () => {
    const jobs: PendingJobInfo[] = [
      { jobId: '1', sessionId: 's1', messageId: 'm1', contentPreview: 'Job 1', createdAt: '2026-06-03T00:00:00Z', status: 'queued' },
      { jobId: '2', sessionId: 's1', messageId: 'm2', contentPreview: 'Job 2', createdAt: '2026-06-03T00:01:00Z', status: 'running' },
    ];

    render(<QueueFloatingPanel pendingJobs={jobs} onCancel={mockOnCancel} />);
    
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    expect(cancelButtons).toHaveLength(1);
    expect(cancelButtons[0]).toHaveAttribute('data-job-id', '1');
  });

  it('cancel button calls onCancel with correct jobId when clicked', () => {
    const jobs: PendingJobInfo[] = [
      { jobId: '1', sessionId: 's1', messageId: 'm1', contentPreview: 'Job 1', createdAt: '2026-06-03T00:00:00Z', status: 'queued' },
    ];

    render(<QueueFloatingPanel pendingJobs={jobs} onCancel={mockOnCancel} />);
    
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
    expect(mockOnCancel).toHaveBeenCalledWith('1');
  });
});

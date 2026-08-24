import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueueFloatingPanel } from '../QueueFloatingPanel.js';
import { useChatStore } from '../../store/chat.store.js';
import type { PendingJobInfo } from '@nebula-link-evo/shared';

// Mock fetch
global.fetch = vi.fn();

describe('QueueFloatingPanel', () => {
  const sessionId = 'test-session-1';

  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.getState().reset();
  });

  it('renders null when pendingJobs is empty array', () => {
    const { container } = render(<QueueFloatingPanel sessionId={sessionId} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders correct number of job items', () => {
    const jobs: PendingJobInfo[] = [
      {
        jobId: '1',
        sessionId,
        messageId: 'm1',
        contentPreview: 'Job 1',
        createdAt: '2026-06-03T00:00:00Z',
        status: 'queued',
      },
      {
        jobId: '2',
        sessionId,
        messageId: 'm2',
        contentPreview: 'Job 2',
        createdAt: '2026-06-03T00:01:00Z',
        status: 'running',
      },
    ];

    useChatStore.getState().setPendingJobsFromSnapshot(sessionId, jobs);

    render(<QueueFloatingPanel sessionId={sessionId} />);

    const items = screen.getAllByTestId('queue-job-item');
    expect(items).toHaveLength(2);
  });

  it('shows contentPreview text for each job', () => {
    const jobs: PendingJobInfo[] = [
      {
        jobId: '1',
        sessionId,
        messageId: 'm1',
        contentPreview: 'First job preview',
        createdAt: '2026-06-03T00:00:00Z',
        status: 'queued',
      },
    ];

    useChatStore.getState().setPendingJobsFromSnapshot(sessionId, jobs);

    render(<QueueFloatingPanel sessionId={sessionId} />);

    expect(screen.getByText('First job preview')).toBeInTheDocument();
  });

  it('shows yellow dot for queued status, green dot for running status', () => {
    const jobs: PendingJobInfo[] = [
      {
        jobId: '1',
        sessionId,
        messageId: 'm1',
        contentPreview: 'Job 1',
        createdAt: '2026-06-03T00:00:00Z',
        status: 'queued',
      },
      {
        jobId: '2',
        sessionId,
        messageId: 'm2',
        contentPreview: 'Job 2',
        createdAt: '2026-06-03T00:01:00Z',
        status: 'running',
      },
    ];

    useChatStore.getState().setPendingJobsFromSnapshot(sessionId, jobs);

    render(<QueueFloatingPanel sessionId={sessionId} />);

    const queuedDot = screen.getByTestId('status-dot-1');
    const runningDot = screen.getByTestId('status-dot-2');

    expect(queuedDot).toHaveAttribute('data-status', 'queued');
    expect(runningDot).toHaveAttribute('data-status', 'running');
  });

  it('cancel button present for queued jobs, absent for running jobs', () => {
    const jobs: PendingJobInfo[] = [
      {
        jobId: '1',
        sessionId,
        messageId: 'm1',
        contentPreview: 'Job 1',
        createdAt: '2026-06-03T00:00:00Z',
        status: 'queued',
      },
      {
        jobId: '2',
        sessionId,
        messageId: 'm2',
        contentPreview: 'Job 2',
        createdAt: '2026-06-03T00:01:00Z',
        status: 'running',
      },
    ];

    useChatStore.getState().setPendingJobsFromSnapshot(sessionId, jobs);

    render(<QueueFloatingPanel sessionId={sessionId} />);

    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    expect(cancelButtons).toHaveLength(1);
    expect(cancelButtons[0]).toHaveAttribute('data-job-id', '1');
  });

  it('cancel button calls DELETE API with correct URL when clicked', async () => {
    const jobs: PendingJobInfo[] = [
      {
        jobId: '1',
        sessionId,
        messageId: 'm1',
        contentPreview: 'Job 1',
        createdAt: '2026-06-03T00:00:00Z',
        status: 'queued',
      },
    ];

    useChatStore.getState().setPendingJobsFromSnapshot(sessionId, jobs);

    (global.fetch as any).mockResolvedValueOnce({ ok: true });

    render(<QueueFloatingPanel sessionId={sessionId} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(`/api/v1/chat/sessions/${sessionId}/jobs/1`, {
        method: 'DELETE',
      });
    });
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InteractionDetailModal } from './InteractionDetailModal.js';
import type { Interaction } from '../types/index.js';

const mockInteraction: Interaction = {
  id: 'int-123',
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
};

describe('InteractionDetailModal', () => {
  it('renders nothing when interaction is null', () => {
    const { container } = render(
      <InteractionDetailModal interaction={null} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders interaction details when provided', () => {
    render(
      <InteractionDetailModal interaction={mockInteraction} onClose={vi.fn()} />
    );
    
    expect(screen.getByTestId('interaction-detail-modal')).toBeInTheDocument();
    expect(screen.getByText('int-123')).toBeInTheDocument();
    expect(screen.getByText('click')).toBeInTheDocument();
    expect(screen.getByText('button')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders error block when interaction failed', () => {
    const failedInteraction = {
      ...mockInteraction,
      success: false,
      error_code: 'TIMEOUT',
      error_message: 'Element not found',
    };

    render(
      <InteractionDetailModal interaction={failedInteraction} onClose={vi.fn()} />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Error Details')).toBeInTheDocument();
    expect(screen.getByText('Code: TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('Element not found')).toBeInTheDocument();
  });
});

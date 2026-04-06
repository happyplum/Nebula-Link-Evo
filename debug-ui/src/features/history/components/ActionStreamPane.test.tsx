import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InteractionFilters } from '../types/index.js';
import { ActionStreamPane } from './ActionStreamPane.js';
import { useExecutionStore } from '../store.js';

const mockUseInteractions = vi.fn();

vi.mock('../api/history.queries.js', () => ({
  useTaskDetail: vi.fn(() => ({
    data: {
      taskId: 'task-1',
      startTime: '2026-01-15T12:00:00.000Z',
    },
  })),
  useInteractionStats: vi.fn(() => ({
    data: {
      data: {
        by_action_type: { click: 4 },
      },
    },
  })),
  useInteractions: (filters?: InteractionFilters) => {
    mockUseInteractions(filters);
    return {
      data: {
        data: [
          {
            id: 'interaction-1',
            timestamp: 1711929600000,
            snapshot_id: 'snap-1',
            nebula_id: 'neb-1',
            action_type: 'click',
            target_type: 'button',
            locator_strategy: 'css',
            success: true,
            attempts: 1,
            latency_ms: 160,
            error_code: null,
            error_message: null,
            failure_sample_path: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    };
  },
}));

vi.mock('./InteractionsTable.js', () => ({
  InteractionsTable: () => <div data-testid="interactions-table-stub" />,
}));

describe('ActionStreamPane', () => {
  beforeEach(() => {
    mockUseInteractions.mockReset();
    useExecutionStore.setState({
      activeTab: 'interactions',
      selectedTaskId: 'task-1',
      interactionFilters: { limit: 50, offset: 0 },
      statsOverlayOpen: false,
    });
  });

  it('uses filters from props instead of reading filter state from store', () => {
    render(
      <ActionStreamPane
        filters={{
          success: false,
          actionType: 'type',
          locatorStrategy: 'xpath',
          startTime: new Date('2026-01-01T00:00:00.000Z').getTime(),
          limit: 50,
          offset: 0,
        }}
      />
    );

    expect(screen.getByTestId('interactions-table-stub')).toBeInTheDocument();

    const lastCall = mockUseInteractions.mock.calls.at(-1)?.[0] as InteractionFilters;
    expect(lastCall).toMatchObject({
      success: false,
      actionType: 'type',
      locatorStrategy: 'xpath',
      limit: 50,
      offset: 0,
    });
    expect(lastCall.startTime).toBe(new Date('2026-01-15T12:00:00.000Z').getTime());
  });
});

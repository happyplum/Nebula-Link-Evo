import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ExecutionPage from '../ExecutionPage.js';
import { useExecutionStore } from '@/features/history/store.js';

const mockNavigate = vi.fn();
const executionShellProps: Array<{ filters: Record<string, unknown> }> = [];

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/features/history/components/index.js', () => ({
  ExecutionShell: (props: { filters: Record<string, unknown> }) => {
    executionShellProps.push(props);
    return <div data-testid="mock-execution-shell" />;
  },
}));

vi.mock('@/features/history/api/history.queries.js', () => ({
  useInteractionStats: () => ({
    data: {
      data: {
        total: 20,
        success_count: 18,
        failure_count: 2,
        success_rate: 0.9,
        avg_latency_ms: 320,
        avg_attempts: 1.1,
        by_action_type: {
          click: 12,
          type: 8,
        },
        by_target_type: {},
      },
    },
    isLoading: false,
    error: null,
  }),
  useInteractions: () => ({
    data: {
      data: [{ locator_strategy: 'css' }, { locator_strategy: 'xpath' }],
    },
    isLoading: false,
    error: null,
  }),
}));

describe('ExecutionPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    executionShellProps.length = 0;
    useExecutionStore.setState({
      activeTab: 'tasks',
      selectedTaskId: null,
      interactionFilters: { limit: 50, offset: 0 },
      statsOverlayOpen: false,
    });
  });

  it('renders global filters and passes updated filters to ExecutionShell', () => {
    render(<ExecutionPage />);

    expect(screen.getByRole('heading', { name: '🌌 Nebula Debug · 执行记录' })).toBeInTheDocument();
    expect(screen.getByTestId('mock-execution-shell')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('execution-shell-filter-status'), {
      target: { value: 'failure' },
    });
    fireEvent.change(screen.getByTestId('execution-shell-filter-type'), {
      target: { value: 'type' },
    });
    fireEvent.change(screen.getByTestId('execution-shell-filter-locator'), {
      target: { value: 'xpath' },
    });

    const lastCall = executionShellProps[executionShellProps.length - 1];
    expect(lastCall.filters).toMatchObject({
      success: false,
      actionType: 'type',
      locatorStrategy: 'xpath',
      limit: 50,
      offset: 0,
    });
  });

  it('navigates back to debug page and can reset filters', () => {
    useExecutionStore.setState({
      interactionFilters: {
        success: true,
        actionType: 'click',
        locatorStrategy: 'css',
        startTime: new Date('2026-01-01T00:00:00').getTime(),
        limit: 50,
        offset: 0,
      },
    });

    render(<ExecutionPage />);

    fireEvent.click(screen.getByRole('button', { name: '← 返回调试' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');

    fireEvent.click(screen.getByRole('button', { name: '重置筛选' }));

    expect(useExecutionStore.getState().interactionFilters).toEqual({ limit: 50, offset: 0 });
  });
});

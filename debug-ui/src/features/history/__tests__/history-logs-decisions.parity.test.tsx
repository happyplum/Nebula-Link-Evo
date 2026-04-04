import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryShell } from '@/features/history/components/HistoryShell.js';
import { useTaskHistory } from '@/features/history/api/history.queries.js';
import { testIds } from '@/shared/testing/testids.js';
import type { TaskRecord, TaskDetail } from '@/features/history/types/index.js';

const { mockUseQueries } = vi.hoisted(() => ({
  mockUseQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueries: mockUseQueries,
}));

vi.mock('@/features/history/api/history.queries.js', () => ({
  useTaskHistory: vi.fn(),
  useTaskDetail: vi.fn().mockReturnValue({ data: undefined, isLoading: false, error: null }),
}));

/**
 * P3-22-V History Logs & Decisions View Parity Tests
 *
 * Verifies LogsView and DecisionsView render correctly within HistoryShell,
 * covering empty states, populated content, status badges, step lists,
 * result/error sections, loading states, and bidirectional tab switching.
 */
describe('P3-22-V: History Logs & Decisions View Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTasks: TaskRecord[] = [
    {
      taskId: 'task-1',
      url: 'https://example.com/page1',
      instruction: 'Navigate to example.com',
      status: 'completed',
      startTime: '2024-03-31T12:00:00Z',
      stepCount: 2,
    },
    {
      taskId: 'task-2',
      url: 'https://example.com/page2',
      instruction: 'Click the submit button',
      status: 'failed',
      startTime: '2024-03-31T12:05:00Z',
      stepCount: 1,
    },
  ];

  const mockDetail1: TaskDetail = {
    ...mockTasks[0],
    endTime: '2024-03-31T12:01:00Z',
    result: 'Navigation successful',
    error: null,
    steps: [
      {
        step: 1,
        action: { type: 'navigate' },
        message: 'Navigating to URL',
        timestamp: '2024-03-31T12:00:10Z',
        success: true,
      },
      {
        step: 2,
        action: { type: 'click' },
        message: 'Clicked target element',
        timestamp: '2024-03-31T12:00:20Z',
        success: true,
      },
    ],
  };

  const mockDetail2: TaskDetail = {
    ...mockTasks[1],
    endTime: '2024-03-31T12:06:00Z',
    result: null,
    error: 'Element not found',
    steps: [
      {
        step: 1,
        action: { type: 'click' },
        message: 'Failed to find element',
        timestamp: '2024-03-31T12:05:30Z',
        success: false,
      },
    ],
  };

  function setupMocks(opts?: {
    taskData?: { tasks: TaskRecord[] };
    detailQueries?: Array<{ data: TaskDetail | undefined; isLoading: boolean }>;
  }) {
    vi.mocked(useTaskHistory).mockReturnValue({
      data: opts?.taskData ?? { tasks: mockTasks },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTaskHistory>);

    mockUseQueries.mockReturnValue(
      opts?.detailQueries ?? [
        { data: mockDetail1, isLoading: false },
        { data: mockDetail2, isLoading: false },
      ],
    );
  }

  // ─── LogsView ────────────────────────────────────────────

  describe('LogsView', () => {
    it('shows empty state "暂无日志记录" when no tasks exist', () => {
      setupMocks({ taskData: { tasks: [] }, detailQueries: [] });

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('日志'));

      const empty = screen.getByTestId(testIds.historyShellLogsEmpty);
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveTextContent('暂无日志记录');
    });

    it('shows empty state when tasks exist but have no steps', () => {
      const taskNoSteps = [
        {
          taskId: 'task-empty',
          url: 'https://example.com',
          instruction: 'Empty task',
          status: 'completed',
          startTime: '2024-03-31T12:00:00Z',
          stepCount: 0,
        },
      ] as TaskRecord[];

      setupMocks({
        taskData: { tasks: taskNoSteps },
        detailQueries: [
          {
            data: { ...taskNoSteps[0], endTime: null, result: null, error: null, steps: [] } as TaskDetail,
            isLoading: false,
          },
        ],
      });

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('日志'));

      expect(screen.getByTestId(testIds.historyShellLogsEmpty)).toHaveTextContent('暂无日志记录');
    });

    it('renders chronological log entries with step messages', () => {
      setupMocks();

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('日志'));

      // 3 entries: 2 from task-1 + 1 from task-2, sorted chronologically
      expect(screen.getByText('Navigating to URL')).toBeInTheDocument();
      expect(screen.getByText('Clicked target element')).toBeInTheDocument();
      expect(screen.getByText('Failed to find element')).toBeInTheDocument();

      // Step labels present (task-1 step 1, task-1 step 2, task-2 step 1)
      const step1Labels = screen.getAllByText(/Step 1/);
      expect(step1Labels).toHaveLength(2); // one from each task
      expect(screen.getByText(/Step 2/)).toBeInTheDocument();
    });

    it('shows loading state "加载中..." when history query is loading', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useTaskHistory>);
      mockUseQueries.mockReturnValue([]);

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('日志'));

      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });

    it('renders entries from partial detail queries (some undefined)', () => {
      setupMocks({
        detailQueries: [
          { data: mockDetail1, isLoading: false },
          { data: undefined, isLoading: true },
        ],
      });

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('日志'));

      // Only task-1 steps rendered; task-2 still loading
      expect(screen.getByText('Navigating to URL')).toBeInTheDocument();
      expect(screen.getByText('Clicked target element')).toBeInTheDocument();
      expect(screen.queryByText('Failed to find element')).not.toBeInTheDocument();
    });
  });

  // ─── DecisionsView ───────────────────────────────────────

  describe('DecisionsView', () => {
    it('shows empty state "暂无决策记录" when no tasks exist', () => {
      setupMocks({ taskData: { tasks: [] }, detailQueries: [] });

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      const empty = screen.getByTestId(testIds.historyShellDecisionsEmpty);
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveTextContent('暂无决策记录');
    });

    it('renders task groups with instruction headers', () => {
      setupMocks();

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      expect(screen.getByText('Navigate to example.com')).toBeInTheDocument();
      expect(screen.getByText('Click the submit button')).toBeInTheDocument();
    });

    it('renders localized status badges (完成 / 失败)', () => {
      setupMocks();

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      expect(screen.getByText('完成')).toBeInTheDocument();
      expect(screen.getByText('失败')).toBeInTheDocument();
    });

    it('renders step lists with action types', () => {
      setupMocks();

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      // Action types from step.action.type
      expect(screen.getByText('navigate')).toBeInTheDocument();
      // Two "click" action types (task-1 step 2 + task-2 step 1)
      const clickLabels = screen.getAllByText('click');
      expect(clickLabels).toHaveLength(2);
    });

    it('renders result and error sections', () => {
      setupMocks();

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      // mockDetail1 has result
      expect(screen.getByText(/Navigation successful/)).toBeInTheDocument();
      // mockDetail2 has error
      expect(screen.getByText(/Element not found/)).toBeInTheDocument();
    });

    it('shows loading state "加载中..." when history query is loading', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as ReturnType<typeof useTaskHistory>);
      mockUseQueries.mockReturnValue([]);

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });

    it('renders task group without step list when detail is pending', () => {
      setupMocks({
        detailQueries: [
          { data: undefined, isLoading: true },
          { data: undefined, isLoading: true },
        ],
      });

      render(<HistoryShell />);
      fireEvent.click(screen.getByText('决策'));

      // Task headers still visible (instruction comes from task list)
      expect(screen.getByText('Navigate to example.com')).toBeInTheDocument();
      // Step content not rendered
      expect(screen.queryByText('navigate')).not.toBeInTheDocument();
      expect(screen.queryByText(/Navigation successful/)).not.toBeInTheDocument();
    });
  });

  // ─── Tab Switching ───────────────────────────────────────

  describe('Tab Switching', () => {
    it('switches 历史 → 日志 and renders logs content', () => {
      setupMocks();
      render(<HistoryShell />);

      expect(screen.getByTestId('history-table')).toBeInTheDocument();
      fireEvent.click(screen.getByText('日志'));

      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();
      expect(screen.getByText('Navigating to URL')).toBeInTheDocument();
    });

    it('switches 日志 → 决策 and renders decisions content', () => {
      setupMocks();
      render(<HistoryShell />);

      fireEvent.click(screen.getByText('日志'));
      // "Step 1:" is LogsView-specific label format
      expect(screen.getAllByText(/Step \d/).length).toBeGreaterThan(0);

      fireEvent.click(screen.getByText('决策'));
      // LogsView step labels gone; DecisionsView uses "#N" format instead
      expect(screen.queryByText(/Step \d/)).not.toBeInTheDocument();
      expect(screen.getByText('完成')).toBeInTheDocument();
    });

    it('switches 决策 → 历史 and restores history table', () => {
      setupMocks();
      render(<HistoryShell />);

      fireEvent.click(screen.getByText('决策'));
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('历史'));
      expect(screen.getByTestId('history-table')).toBeInTheDocument();
    });

    it('completes full cycle: 历史 → 日志 → 决策 → 历史', () => {
      setupMocks();
      render(<HistoryShell />);

      // 历史 (default)
      expect(screen.getByTestId('history-table')).toBeInTheDocument();

      // → 日志
      fireEvent.click(screen.getByText('日志'));
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();
      expect(screen.getAllByText(/Step \d/).length).toBeGreaterThan(0);

      // → 决策 (LogsView "Step N:" labels gone)
      fireEvent.click(screen.getByText('决策'));
      expect(screen.queryByText(/Step \d/)).not.toBeInTheDocument();
      expect(screen.getByText('完成')).toBeInTheDocument();

      // → 历史
      fireEvent.click(screen.getByText('历史'));
      expect(screen.queryByText('完成')).not.toBeInTheDocument();
      expect(screen.getByTestId('history-table')).toBeInTheDocument();
    });

    it('only renders the active tab content (no cross-tab leaks)', () => {
      setupMocks();
      render(<HistoryShell />);

      // Tasks tab: no step labels (LogsView) or status badges (DecisionsView)
      expect(screen.queryByText(/Step \d/)).not.toBeInTheDocument();
      expect(screen.queryByText('完成')).not.toBeInTheDocument();

      // Logs tab: no history table or DecisionsView status badges
      fireEvent.click(screen.getByText('日志'));
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();
      expect(screen.queryByText('完成')).not.toBeInTheDocument();

      // Decisions tab: no history table or LogsView step labels
      fireEvent.click(screen.getByText('决策'));
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();
      expect(screen.queryByText(/Step \d/)).not.toBeInTheDocument();
    });
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HistoryShell } from '@/features/history/components/HistoryShell.js';
import { useTaskHistory } from '@/features/history/api/history.queries.js';
import { testIds } from '@/shared/testing/testids.js';
import type { TaskRecord } from '@/features/history/types/index.js';

vi.mock('@/features/history/api/history.queries.js', () => ({
  useTaskHistory: vi.fn(),
  useTaskDetail: vi.fn().mockReturnValue({ data: undefined, isLoading: false, error: null }),
}));

vi.mock('@/features/history/components/LogsView.js', () => ({
  LogsView: () => <div data-testid={testIds.historyShellLogsEmpty}>暂无日志记录</div>,
}));

vi.mock('@/features/history/components/DecisionsView.js', () => ({
  DecisionsView: () => <div data-testid={testIds.historyShellDecisionsEmpty}>暂无决策记录</div>,
}));

/**
 * P3-21-V History Tasks View Parity Tests
 *
 * Verifies that HistoryShell renders task history table correctly.
 * Tests:
 * - HistoryTable renders when "历史" tab is active (default)
 * - Empty state shows "暂无任务记录"
 * - Tab switching works (历史/日志/决策)
 * - Mock data renders correctly in table
 */
describe('P3-21-V: HistoryShell - Tasks View Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Note: History feature does not have a Zustand store to reset
    // Other features with stores would reset them here
  });

  const mockTasks: TaskRecord[] = [
    {
      taskId: 'task-1',
      url: 'https://example.com/page1',
      instruction: 'Navigate to example.com',
      status: 'completed',
      startTime: '2024-03-31T12:00:00Z',
      stepCount: 5,
    },
    {
      taskId: 'task-2',
      url: 'https://example.com/page2',
      instruction: 'Click the submit button',
      status: 'failed',
      startTime: '2024-03-31T12:05:00Z',
      stepCount: 2,
    },
  ];

  describe('Default State - Tasks Tab Active', () => {
    it('renders HistoryTable when "历史" tab is active', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      // Verify "历史" tab is visible
      expect(screen.getByText('历史')).toBeInTheDocument();

      // Verify history table is rendered
      const historyTable = screen.getByTestId('history-table');
      expect(historyTable).toBeInTheDocument();
    });

    it('renders empty state "暂无任务记录" when no tasks exist', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: [] },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      const emptyState = screen.getByTestId(testIds.historyShellTasksEmpty);
      expect(emptyState).toBeInTheDocument();
      expect(emptyState).toHaveTextContent('暂无任务记录');
    });

    it('renders loading state when query is loading', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      } as any);

      render(<HistoryShell />);

      expect(screen.getByText('Loading history...')).toBeInTheDocument();
    });

    it('renders error state when query fails', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Failed to fetch'),
      } as any);

      render(<HistoryShell />);

      expect(screen.getByText('Failed to load history')).toBeInTheDocument();
    });
  });

  describe('Tab Switching', () => {
    it('switches from 历史 to 日志 tab', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      // Verify initial state - history table is visible
      expect(screen.getByTestId('history-table')).toBeInTheDocument();

      // Click on 日志 tab
      const logsTab = screen.getByText('日志');
      fireEvent.click(logsTab);

      // Verify history table is no longer visible
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();

      // Verify logs empty state is now visible
      const logsEmpty = screen.getByTestId(testIds.historyShellLogsEmpty);
      expect(logsEmpty).toBeInTheDocument();
      expect(logsEmpty).toHaveTextContent('暂无日志记录');
    });

    it('switches from 历史 to 决策 tab', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      // Verify initial state - history table is visible
      expect(screen.getByTestId('history-table')).toBeInTheDocument();

      // Click on 决策 tab
      const decisionsTab = screen.getByText('决策');
      fireEvent.click(decisionsTab);

      // Verify history table is no longer visible
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();

      // Verify decisions empty state is now visible
      const decisionsEmpty = screen.getByTestId(testIds.historyShellDecisionsEmpty);
      expect(decisionsEmpty).toBeInTheDocument();
      expect(decisionsEmpty).toHaveTextContent('暂无决策记录');
    });

    it('switches back from 日志 to 历史 tab and restores table', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      // Click on 日志 tab
      fireEvent.click(screen.getByText('日志'));
      expect(screen.queryByTestId('history-table')).not.toBeInTheDocument();

      // Click back on 历史 tab
      fireEvent.click(screen.getByText('历史'));

      // Verify history table is visible again
      expect(screen.getByTestId('history-table')).toBeInTheDocument();
    });
  });

  describe('Table Content', () => {
    it('renders task data correctly in table rows', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      const rows = screen.getAllByTestId('history-table-row');
      expect(rows).toHaveLength(2);

      // Verify first task data
      expect(screen.getByText('Navigate to example.com')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();

      // Verify second task data
      expect(screen.getByText('Click the submit button')).toBeInTheDocument();
      expect(screen.getByText('failed')).toBeInTheDocument();
      expect(screen.getAllByText('2')).toHaveLength(1);
    });

    it('renders all three tab labels (历史/日志/决策)', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      render(<HistoryShell />);

      expect(screen.getByText('历史')).toBeInTheDocument();
      expect(screen.getByText('日志')).toBeInTheDocument();
      expect(screen.getByText('决策')).toBeInTheDocument();
    });
  });

  describe('TestId Integrity', () => {
    it('verifies all expected testids are present', () => {
      vi.mocked(useTaskHistory).mockReturnValue({
        data: { tasks: mockTasks },
        isLoading: false,
        error: null,
      } as any);

      const { container } = render(<HistoryShell />);

      // HistoryShell container
      expect(container.querySelector(`[data-testid="${testIds.historyShell}"]`)).toBeInTheDocument();

      // Tab content area
      expect(container.querySelector(`[data-testid="${testIds.historyShellTabContent}"]`)).toBeInTheDocument();

      // History table
      expect(container.querySelector('[data-testid="history-table"]')).toBeInTheDocument();

      // Tab labels (via Tabs component)
      expect(screen.getByText('历史')).toBeInTheDocument();
      expect(screen.getByText('日志')).toBeInTheDocument();
      expect(screen.getByText('决策')).toBeInTheDocument();
    });
  });
});

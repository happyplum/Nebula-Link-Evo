import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoryShell } from '@/features/history/components/HistoryShell.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('@/features/history/components/HistoryTable.js', () => ({
  HistoryTable: () => <div data-testid={testIds.historyShellTasksEmpty}>暂无任务记录</div>,
}));

vi.mock('@/features/history/components/LogsView.js', () => ({
  LogsView: () => <div data-testid={testIds.historyShellLogsEmpty}>暂无日志记录</div>,
}));

vi.mock('@/features/history/components/DecisionsView.js', () => ({
  DecisionsView: () => <div data-testid={testIds.historyShellDecisionsEmpty}>暂无决策记录</div>,
}));

/**
 * P2-14 History Shell Parity Tests
 *
 * Verifies that HistoryShell renders the expected structural regions and testids.
 * Tests the 3 sub-tabs (历史/日志/决策), tab content areas with empty states,
 * and verifies all elements have correct testids.
 */
describe('P2-14 HistoryShell - Parity', () => {
  it('renders HistoryShell with correct testid', () => {
    render(<HistoryShell />);

    const shell = screen.getByTestId(testIds.historyShell);
    expect(shell).toBeInTheDocument();
    expect(shell.tagName).toBe('DIV');
  });

  it('renders tab content area with correct testid', () => {
    render(<HistoryShell />);

    const tabContent = screen.getByTestId(testIds.historyShellTabContent);
    expect(tabContent).toBeInTheDocument();
    expect(tabContent.tagName).toBe('DIV');
  });

  it('renders tasks tab empty state with correct testid', () => {
    render(<HistoryShell />);

    const tasksEmpty = screen.getByTestId(testIds.historyShellTasksEmpty);
    expect(tasksEmpty).toBeInTheDocument();
    expect(tasksEmpty.tagName).toBe('DIV');
    expect(tasksEmpty.textContent).toBe('暂无任务记录');
  });

  it('logs tab empty state is not in DOM by default (conditional rendering)', () => {
    render(<HistoryShell />);

    const logsEmpty = screen.queryByTestId(testIds.historyShellLogsEmpty);
    expect(logsEmpty).not.toBeInTheDocument();
  });

  it('decisions tab empty state is not in DOM by default (conditional rendering)', () => {
    render(<HistoryShell />);

    const decisionsEmpty = screen.queryByTestId(testIds.historyShellDecisionsEmpty);
    expect(decisionsEmpty).not.toBeInTheDocument();
  });

  it('renders all three tab labels correctly', () => {
    render(<HistoryShell />);

    // Tabs component should render the three tab labels
    expect(screen.getByText('历史')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('决策')).toBeInTheDocument();
  });

  it('verifies default active tab is tasks', () => {
    render(<HistoryShell />);

    // Default active tab should be 'tasks'
    const tasksEmpty = screen.getByTestId(testIds.historyShellTasksEmpty);
    expect(tasksEmpty).toBeVisible();
  });

  it('contains all expected testids for HistoryShell in DOM', () => {
    const { container } = render(<HistoryShell />);

    // Verify shell testid
    expect(container.querySelector(`[data-testid="${testIds.historyShell}"]`)).toBeInTheDocument();

    // Verify tab content testid
    expect(container.querySelector(`[data-testid="${testIds.historyShellTabContent}"]`)).toBeInTheDocument();

    // Verify default active tab empty state (tasks)
    expect(container.querySelector(`[data-testid="${testIds.historyShellTasksEmpty}"]`)).toBeInTheDocument();

    // Verify other tabs are not in DOM (conditional rendering)
    expect(container.querySelector(`[data-testid="${testIds.historyShellLogsEmpty}"]`)).not.toBeInTheDocument();
    expect(container.querySelector(`[data-testid="${testIds.historyShellDecisionsEmpty}"]`)).not.toBeInTheDocument();
  });
});

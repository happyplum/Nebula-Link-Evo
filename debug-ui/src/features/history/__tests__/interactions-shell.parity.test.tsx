import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { InteractionsShell } from '../components/InteractionsShell.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../api/history.queries.js', () => ({
  useInteractions: () => ({ data: { data: [] }, isLoading: false, error: null }),
  useInteractionStats: () => ({ data: { data: null } }),
}));

vi.mock('../hooks/useInteractionFilters.js', () => ({
  useInteractionFilters: () => ({ filters: {}, updateFilters: () => {} }),
}));

/**
 * Parity test for P2-15: Interactions Shell
 *
 * Tests structural rendering and testid placement for InteractionsShell.
 * Verifies that the component renders all expected regions with correct testids.
 * Phase 2 close verification - confirms shell is complete and no longer leaks into History.
 */
describe('P2-15: Interactions Shell - Parity', () => {
  it('renders root container with correct testid', () => {
    render(<InteractionsShell />);
    expect(screen.getByTestId(testIds.interactionsShell)).toBeInTheDocument();
  });

  it('renders Filter Rail region with correct testid', () => {
    render(<InteractionsShell />);
    const filterRail = screen.getByTestId(testIds.interactionsShellFilterRail);
    expect(filterRail).toBeInTheDocument();
  });

  it('renders Filter Rail controls with correct testids', () => {
    render(<InteractionsShell />);

    // Status select
    const statusSelect = screen.getByTestId(testIds.interactionsShellFilterStatus);
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect.tagName).toBe('SELECT');

    // Type select
    const typeSelect = screen.getByTestId(testIds.interactionsShellFilterType);
    expect(typeSelect).toBeInTheDocument();
    expect(typeSelect.tagName).toBe('SELECT');

    // Date start input
    const dateStart = screen.getByTestId(testIds.interactionsShellFilterDateStart);
    expect(dateStart).toBeInTheDocument();
    expect(dateStart).toHaveAttribute('type', 'date');

    // Date end input (disabled)
    const dateEnd = screen.getByTestId(testIds.interactionsShellFilterDateEnd);
    expect(dateEnd).toBeInTheDocument();
    expect(dateEnd).toHaveAttribute('disabled');
    expect(dateEnd).toHaveAttribute('type', 'date');
  });

  it('renders Status select with correct options', () => {
    render(<InteractionsShell />);
    const statusSelect = screen.getByTestId(testIds.interactionsShellFilterStatus);

    const options = within(statusSelect).getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveValue('all');
    expect(options[0]).toHaveTextContent('全部');
    expect(options[1]).toHaveValue('success');
    expect(options[1]).toHaveTextContent('成功');
    expect(options[2]).toHaveValue('failure');
    expect(options[2]).toHaveTextContent('失败');
    expect(options[3]).toHaveValue('running');
    expect(options[3]).toHaveTextContent('进行中');
  });

  it('renders Type select with correct options', () => {
    render(<InteractionsShell />);
    const typeSelect = screen.getByTestId(testIds.interactionsShellFilterType);

    const options = within(typeSelect).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveValue('');
    expect(options[0]).toHaveTextContent('全部类型');
  });

  it('renders Stats Strip region with correct testid', () => {
    render(<InteractionsShell />);
    const statsStrip = screen.getByTestId(testIds.interactionsShellStatsStrip);
    expect(statsStrip).toBeInTheDocument();
  });

  it('renders Stats Strip items with correct testids', () => {
    render(<InteractionsShell />);

    // Total stat
    const totalStat = screen.getByTestId(testIds.interactionsShellStatsTotal);
    expect(totalStat).toBeInTheDocument();
    expect(within(totalStat).getByText('总计:')).toBeInTheDocument();
    expect(within(totalStat).getByText('0')).toBeInTheDocument();

    // Success stat
    const successStat = screen.getByTestId(testIds.interactionsShellStatsSuccess);
    expect(successStat).toBeInTheDocument();
    expect(within(successStat).getByText('成功:')).toBeInTheDocument();
    expect(within(successStat).getByText('0')).toBeInTheDocument();

    // Failure stat
    const failureStat = screen.getByTestId(testIds.interactionsShellStatsFailure);
    expect(failureStat).toBeInTheDocument();
    expect(within(failureStat).getByText('失败:')).toBeInTheDocument();
    expect(within(failureStat).getByText('0')).toBeInTheDocument();
  });

  it('renders Table Region with correct testid', () => {
    render(<InteractionsShell />);
    const tableRegion = screen.getByTestId(testIds.interactionsShellTableRegion);
    expect(tableRegion).toBeInTheDocument();
  });

  it('renders Table Region empty state with correct testid', () => {
    render(<InteractionsShell />);
    expect(screen.getByText('暂无交互记录')).toBeInTheDocument();
  });

  it('renders Modal Anchor with correct testid', () => {
    render(<InteractionsShell />);
    const modalAnchor = screen.getByTestId(testIds.interactionsShellModalAnchor);
    expect(modalAnchor).toBeInTheDocument();
  });

  it('asserts all 13 key structural elements exist with correct testids', () => {
    render(<InteractionsShell />);

    // Root container
    expect(screen.getByTestId(testIds.interactionsShell)).toBeInTheDocument();

    // Filter Rail and its 4 controls
    expect(screen.getByTestId(testIds.interactionsShellFilterRail)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellFilterStatus)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellFilterType)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellFilterDateStart)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellFilterDateEnd)).toBeInTheDocument();

    // Stats Strip and its 3 stats
    expect(screen.getByTestId(testIds.interactionsShellStatsStrip)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellStatsTotal)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellStatsSuccess)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellStatsFailure)).toBeInTheDocument();

    // Table Region
    expect(screen.getByTestId(testIds.interactionsShellTableRegion)).toBeInTheDocument();
    expect(screen.getByText('暂无交互记录')).toBeInTheDocument();

    // Modal Anchor
    expect(screen.getByTestId(testIds.interactionsShellModalAnchor)).toBeInTheDocument();
  });

  it('asserts no placeholder text in structural regions', () => {
    render(<InteractionsShell />);

    const interactionsShell = screen.getByTestId(testIds.interactionsShell);
    const shellContent = within(interactionsShell);

    // Check for common placeholder phrases (case-insensitive)
    const placeholderPhrases = ['placeholder', 'coming soon', 'TODO', 'TODO:', 'Coming Soon'];

    placeholderPhrases.forEach((phrase) => {
      expect(shellContent.queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
    });
  });

  it('asserts component does not leak into History shell structure', () => {
    const { container } = render(<InteractionsShell />);

    // Verify root testid is interactionsShell, not historyShell
    expect(container.firstChild).toHaveAttribute('data-testid', testIds.interactionsShell);
    expect(container.firstChild).not.toHaveAttribute('data-testid', testIds.historyShell);

    // Verify InteractionsShell-specific regions are present
    expect(screen.getByTestId(testIds.interactionsShellFilterRail)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactionsShellStatsStrip)).toBeInTheDocument();

    // Verify History-specific regions are NOT present
    expect(screen.queryByTestId(testIds.historyShellTabTasks)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.historyShellTabLogs)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.historyShellTabDecisions)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.historyShellTabContent)).not.toBeInTheDocument();
  });
});

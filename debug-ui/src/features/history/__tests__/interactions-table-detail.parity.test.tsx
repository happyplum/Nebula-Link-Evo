import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import { InteractionsTable } from '../components/InteractionsTable.js';
import { InteractionDetailModal } from '../components/InteractionDetailModal.js';
import { testIds } from '@/shared/testing/testids.js';
import type { Interaction } from '../types/index.js';

dayjs.extend(duration);

// InteractionDetailModal → FailureSampleModal → useFailureSample (TanStack Query)
// InteractionDetailModal → FailureSampleModal → useFailureSample (TanStack Query)
// Mock the query to avoid real network requests
vi.mock('../api/history.queries.js', () => ({
  useFailureSample: () => ({ data: null, isLoading: false, error: null }),
}));

/** Build a complete Interaction with sensible defaults. */
function buildInteraction(overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: 'int-1',
    timestamp: 1700000000000,
    snapshot_id: 'snap-1',
    nebula_id: 'nebula-1',
    action_type: 'click',
    target_type: 'button',
    locator_strategy: 'css',
    success: true,
    attempts: 1,
    latency_ms: 250,
    error_code: null,
    error_message: null,
    failure_sample_path: null,
    ...overrides,
  };
}

describe('P3-24-V: Interactions Table and Detail Modal - Parity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── InteractionsTable states ──────────────────────────────────────

  describe('InteractionsTable - Loading State', () => {
    it('renders loading indicator with "加载中..." label', () => {
      render(<InteractionsTable interactions={[]} isLoading={true} error={null} />);
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });
  });

  describe('InteractionsTable - Error State', () => {
    it('renders error indicator with "加载失败" label', () => {
      render(
        <InteractionsTable
          interactions={[]}
          isLoading={false}
          error={new Error('network')}
        />,
      );
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
  });

  describe('InteractionsTable - Empty State', () => {
    it('renders "暂无交互记录" when interactions array is empty', () => {
      render(<InteractionsTable interactions={[]} isLoading={false} error={null} />);
      expect(screen.getByText('暂无交互记录')).toBeInTheDocument();
    });
  });

  // ── InteractionsTable - Table Headers ──────────────────────────────

  describe('InteractionsTable - Chinese Headers', () => {
    it('renders all 6 column headers: 时间/操作/目标/定位器/状态/耗时', () => {
      const interactions = [buildInteraction()];
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);

      const table = screen.getByTestId(testIds.interactionsTable);
      const headers = within(table).getAllByRole('columnheader');
      expect(headers).toHaveLength(6);

      const headerTexts = headers.map((h) => h.textContent);
      expect(headerTexts).toEqual(['时间', '操作', '目标', '定位器', '状态', '耗时']);
    });
  });

  // ── InteractionsTable - Row Rendering ──────────────────────────────

  describe('InteractionsTable - Row Data', () => {
    const interactions = [
      buildInteraction({ id: 'r1', action_type: 'click', target_type: 'button', success: true, latency_ms: 100, timestamp: 1700000000000 }),
      buildInteraction({ id: 'r2', action_type: 'type', target_type: 'input', success: false, latency_ms: 300, timestamp: 1700000100000, locator_strategy: 'xpath' }),
    ];

    it('renders a row per interaction', () => {
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);
      const rows = screen.getAllByTestId(testIds.interactionsTableRow);
      expect(rows).toHaveLength(2);
    });

    it('renders action_type in each row', () => {
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);
      const tableRegion = screen.getByTestId(testIds.interactionsTable);
      expect(within(tableRegion).getByText('click')).toBeInTheDocument();
      expect(within(tableRegion).getByText('type')).toBeInTheDocument();
    });

    it('renders target_type in each row', () => {
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);
      expect(screen.getByText('button')).toBeInTheDocument();
      expect(screen.getByText('input')).toBeInTheDocument();
    });

    it('renders locator_strategy or dash when empty', () => {
      const mixed = [
        buildInteraction({ id: 'a', locator_strategy: 'css' }),
        buildInteraction({ id: 'b', locator_strategy: '' }),
      ];
      render(<InteractionsTable interactions={mixed} isLoading={false} error={null} />);

      const rows = screen.getAllByTestId(testIds.interactionsTableRow);
      expect(within(rows[0]).getByText('css')).toBeInTheDocument();
      expect(within(rows[1]).getByText('-')).toBeInTheDocument();
    });
  });

  // ── InteractionsTable - Status Badges ──────────────────────────────

  describe('InteractionsTable - Status Badges', () => {
    it('renders "成功" for successful interactions and "失败" for failed ones', () => {
      const interactions = [
        buildInteraction({ id: 's1', success: true }),
        buildInteraction({ id: 's2', success: false }),
      ];
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);

      const badges = screen.getAllByText(/^(成功|失败)$/);
      expect(badges).toHaveLength(2);
      expect(badges[0]).toHaveTextContent('成功');
      expect(badges[1]).toHaveTextContent('失败');
    });
  });

  // ── InteractionsTable - Time and Duration Formatting ──────────────

  describe('InteractionsTable - Formatting', () => {
    it('renders timestamp via formatTime (HH:mm:ss)', () => {
      const ts = 1700000000000; // 2023-11-14T22:13:20.000Z
      const interactions = [buildInteraction({ timestamp: ts })];
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);

      // formatTime outputs HH:mm:ss in local timezone
      const row = screen.getByTestId(testIds.interactionsTableRow);
      const timeCell = row.querySelector('td');
      expect(timeCell?.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('renders latency via formatDuration or dash when null', () => {
      const interactions = [
        buildInteraction({ id: 'l1', latency_ms: 500 }),
        buildInteraction({ id: 'l2', latency_ms: undefined as unknown as number }),
      ];
      render(<InteractionsTable interactions={interactions} isLoading={false} error={null} />);

      // formatDuration(500) produces a humanized string like "a few seconds"
      const rows = screen.getAllByTestId(testIds.interactionsTableRow);
      expect(rows[0].textContent).toContain(dayjs.duration(500).humanize());
      expect(within(rows[1]).getByText('-')).toBeInTheDocument();
    });
  });

  // ── Row Click → Modal Opens ────────────────────────────────────────

  describe('InteractionsTable - Row Click Opens Detail Modal', () => {
    it('opens InteractionDetailModal on row click', () => {
      const interaction = buildInteraction({ id: 'click-test', action_type: 'navigate' });
      render(<InteractionsTable interactions={[interaction]} isLoading={false} error={null} />);

      // Modal should not be visible initially
      expect(screen.queryByTestId('interaction-detail-modal')).not.toBeInTheDocument();

      // Click the row
      const row = screen.getByTestId(testIds.interactionsTableRow);
      fireEvent.click(row);

      // Modal should now be visible
      expect(screen.getByTestId('interaction-detail-modal')).toBeInTheDocument();
    });
  });

  // ── InteractionDetailModal ──────────────────────────────────────────

  describe('InteractionDetailModal - Fields', () => {
    const interaction: Interaction = buildInteraction({
      id: 'modal-1',
      timestamp: 1700000000000,
      action_type: 'scroll',
      target_type: 'window',
      locator_strategy: 'nebula-id',
      success: true,
      attempts: 3,
      latency_ms: 150,
      snapshot_id: 'snap-modal',
      nebula_id: 'nebula-modal',
    });

    it('renders null when interaction is null', () => {
      const { container } = render(
        <InteractionDetailModal interaction={null} onClose={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('renders all field labels: 时间, 操作类型, 目标类型, 定位策略, 状态, 耗时, 尝试次数, 快照 ID, Nebula ID', () => {
      render(<InteractionDetailModal interaction={interaction} onClose={vi.fn()} />);

      const modal = screen.getByTestId('interaction-detail-modal');
      const labels = ['时间', '操作类型', '目标类型', '定位策略', '状态', '耗时', '尝试次数', '快照 ID', 'Nebula ID'];
      for (const label of labels) {
        expect(within(modal).getByText(label)).toBeInTheDocument();
      }
    });

    it('renders field values from interaction data', () => {
      render(<InteractionDetailModal interaction={interaction} onClose={vi.fn()} />);

      const modal = screen.getByTestId('interaction-detail-modal');
      expect(within(modal).getByText('modal-1')).toBeInTheDocument(); // ID
      expect(within(modal).getByText('scroll')).toBeInTheDocument(); // action_type
      expect(within(modal).getByText('window')).toBeInTheDocument(); // target_type
      expect(within(modal).getByText('nebula-id')).toBeInTheDocument(); // locator_strategy
      expect(within(modal).getByText('成功')).toBeInTheDocument(); // status
      expect(within(modal).getByText('3')).toBeInTheDocument(); // attempts
      expect(within(modal).getByText('snap-modal')).toBeInTheDocument(); // snapshot_id
      expect(within(modal).getByText('nebula-modal')).toBeInTheDocument(); // nebula_id
    });

    it('renders timestamp via formatDateTime (YYYY-MM-DD HH:mm:ss)', () => {
      render(<InteractionDetailModal interaction={interaction} onClose={vi.fn()} />);

      const modal = screen.getByTestId('interaction-detail-modal');
      const expectedDate = dayjs(1700000000000).format('YYYY-MM-DD HH:mm:ss');
      expect(within(modal).getByText(expectedDate)).toBeInTheDocument();
    });

    it('renders latency via formatDuration', () => {
      render(<InteractionDetailModal interaction={interaction} onClose={vi.fn()} />);

      const modal = screen.getByTestId('interaction-detail-modal');
      const expected = dayjs.duration(150).humanize();
      expect(within(modal).getByText(expected)).toBeInTheDocument();
    });
  });

  // ── InteractionDetailModal - Error Block ────────────────────────────

  describe('InteractionDetailModal - Error Block', () => {
    it('renders error block with 错误详情 title, 错误码, and message for failed interaction', () => {
      const failed: Interaction = buildInteraction({
        success: false,
        error_code: 'TIMEOUT',
        error_message: 'Element timed out',
        failure_sample_path: '/snapshots/fail.png',
      });
      render(<InteractionDetailModal interaction={failed} onClose={vi.fn()} />);

      expect(screen.getByText('错误详情')).toBeInTheDocument();
      expect(screen.getByText('错误码: TIMEOUT')).toBeInTheDocument();
      expect(screen.getByText('Element timed out')).toBeInTheDocument();
      expect(screen.getByTestId(testIds.failureSampleViewBtn)).toBeInTheDocument();
      expect(screen.getByText('查看样本')).toBeInTheDocument();
    });

    it('does not render error block for successful interaction', () => {
      const success: Interaction = buildInteraction({ success: true });
      render(<InteractionDetailModal interaction={success} onClose={vi.fn()} />);

      expect(screen.queryByText('错误详情')).not.toBeInTheDocument();
    });

    it('does not render error block when failed but no error_code or error_message', () => {
      const failed: Interaction = buildInteraction({
        success: false,
        error_code: null,
        error_message: null,
      });
      render(<InteractionDetailModal interaction={failed} onClose={vi.fn()} />);

      expect(screen.queryByText('错误详情')).not.toBeInTheDocument();
    });
  });

  // ── InteractionDetailModal - Close ──────────────────────────────────

  describe('InteractionDetailModal - Close', () => {
    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      const interaction = buildInteraction();
      render(<InteractionDetailModal interaction={interaction} onClose={onClose} />);

      const closeBtn = screen.getByLabelText('Close modal');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders title "交互详情"', () => {
      render(<InteractionDetailModal interaction={buildInteraction()} onClose={vi.fn()} />);
      expect(screen.getByText('交互详情')).toBeInTheDocument();
    });
  });
});

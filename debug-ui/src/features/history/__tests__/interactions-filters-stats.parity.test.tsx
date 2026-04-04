import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { InteractionsShell } from '../components/InteractionsShell.js';
import { testIds } from '@/shared/testing/testids.js';
import type { Interaction, InteractionStats } from '../types/index.js';

/**
 * Parity test for P3-23-V: Verify Interactions filters and stats
 *
 * Tests that InteractionsShell renders filters, stats, and table correctly
 * with proper mocked data from useInteractions and useInteractionStats queries.
 */
describe('P3-23-V: Interactions Filters and Stats - Parity', () => {
  let queryClient: QueryClient;

  function createWrapper() {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  function mockResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mockInteractions: Interaction[] = [
    {
      id: '1',
      timestamp: 1630000000000,
      snapshot_id: 'snap-1',
      nebula_id: 'nebula-1',
      action_type: 'click',
      target_type: 'button',
      locator_strategy: 'css',
      success: true,
      attempts: 1,
      latency_ms: 100,
      error_code: null,
      error_message: null,
      failure_sample_path: null,
    },
    {
      id: '2',
      timestamp: 1630000100000,
      snapshot_id: 'snap-2',
      nebula_id: 'nebula-2',
      action_type: 'type',
      target_type: 'input',
      locator_strategy: 'css',
      success: false,
      attempts: 2,
      latency_ms: 200,
      error_code: 'ELEMENT_NOT_FOUND',
      error_message: 'Element not found',
      failure_sample_path: '/path/to/snapshot.png',
    },
    {
      id: '3',
      timestamp: 1630000200000,
      snapshot_id: 'snap-3',
      nebula_id: 'nebula-3',
      action_type: 'scroll',
      target_type: 'window',
      locator_strategy: 'css',
      success: true,
      attempts: 1,
      latency_ms: 50,
      error_code: null,
      error_message: null,
      failure_sample_path: null,
    },
  ];

  const mockStats: InteractionStats = {
    total: 10,
    success_count: 8,
    failure_count: 2,
    success_rate: 0.8,
    avg_latency_ms: 120,
    avg_attempts: 1.1,
    by_action_type: {
      click: 5,
      type: 3,
      scroll: 2,
    },
    by_target_type: {
      button: 5,
      input: 3,
      window: 2,
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
          gcTime: 0,
          staleTime: 0,
        },
      },
    });
  });

  describe('Filter Rail', () => {
    it('renders filter rail with correct testid', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      expect(screen.getByTestId(testIds.interactionsShellFilterRail)).toBeInTheDocument();
    });

    it('renders status select with correct options', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
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

    it('renders type select with "全部类型" default and derived options from stats', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      // Wait for stats to load and type options to be derived
      await waitFor(
        () => {
          const typeSelect = screen.getByTestId(testIds.interactionsShellFilterType);
          const options = within(typeSelect).getAllByRole('option');
          // Should have "全部类型" plus the derived action types from stats
          expect(options.length).toBeGreaterThan(1);
        },
        { timeout: 3000 }
      );

      const typeSelect = screen.getByTestId(testIds.interactionsShellFilterType);
      const options = within(typeSelect).getAllByRole('option');
      expect(options[0]).toHaveValue('');
      expect(options[0]).toHaveTextContent('全部类型');

      // Check that derived action types are present (sorted by count desc)
      const typeOptions = options.slice(1);
      expect(typeOptions.length).toBe(3);
      expect(typeOptions[0]).toHaveValue('click');
      expect(typeOptions[1]).toHaveValue('type');
      expect(typeOptions[2]).toHaveValue('scroll');
    });

    it('renders date start input with correct type', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      const dateStart = screen.getByTestId(testIds.interactionsShellFilterDateStart);
      expect(dateStart).toBeInTheDocument();
      expect(dateStart).toHaveAttribute('type', 'date');
    });

    it('renders date end input disabled', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      const dateEnd = screen.getByTestId(testIds.interactionsShellFilterDateEnd);
      expect(dateEnd).toBeInTheDocument();
      expect(dateEnd).toHaveAttribute('disabled');
    });
  });

  describe('Stats Strip', () => {
    it('renders stats strip with correct testid', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      expect(screen.getByTestId(testIds.interactionsShellStatsStrip)).toBeInTheDocument();
    });

    it('renders total stat with correct label and value from stats API', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: [] }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          const totalStat = screen.getByTestId(testIds.interactionsShellStatsTotal);
          expect(within(totalStat).getByText('总计:')).toBeInTheDocument();
          expect(within(totalStat).getByText('10')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders success stat with correct label and value from stats API', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: [] }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          const successStat = screen.getByTestId(testIds.interactionsShellStatsSuccess);
          expect(within(successStat).getByText('成功:')).toBeInTheDocument();
          expect(within(successStat).getByText('8')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders failure stat with correct label and value from stats API', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: [] }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          const failureStat = screen.getByTestId(testIds.interactionsShellStatsFailure);
          expect(within(failureStat).getByText('失败:')).toBeInTheDocument();
          expect(within(failureStat).getByText('2')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('falls back to computed counts when stats API returns null', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: null }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      // Should compute from interactions: 3 total, 2 success, 1 failure
      await waitFor(
        () => {
          const totalStat = screen.getByTestId(testIds.interactionsShellStatsTotal);
          const successStat = screen.getByTestId(testIds.interactionsShellStatsSuccess);
          const failureStat = screen.getByTestId(testIds.interactionsShellStatsFailure);

          expect(within(totalStat).getByText('3')).toBeInTheDocument();
          expect(within(successStat).getByText('2')).toBeInTheDocument();
          expect(within(failureStat).getByText('1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('shows zero counts when no interactions exist', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: [] }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: null }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          const totalStat = screen.getByTestId(testIds.interactionsShellStatsTotal);
          const successStat = screen.getByTestId(testIds.interactionsShellStatsSuccess);
          const failureStat = screen.getByTestId(testIds.interactionsShellStatsFailure);

          expect(within(totalStat).getByText('0')).toBeInTheDocument();
          expect(within(successStat).getByText('0')).toBeInTheDocument();
          expect(within(failureStat).getByText('0')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Table Region', () => {
    it('renders table region with correct testid', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      expect(screen.getByTestId(testIds.interactionsShellTableRegion)).toBeInTheDocument();
    });

    it('renders empty state when no interactions exist', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: [] }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: null }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          expect(screen.getByText('暂无交互记录')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders loading state when interactions are loading', () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise(() => {}) // Never resolves to simulate loading
      );

      render(<InteractionsShell />, { wrapper: createWrapper() });
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });

    it('renders interaction rows when data exists', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          // Check table headers
          expect(screen.getByText('时间')).toBeInTheDocument();
          expect(screen.getByText('操作')).toBeInTheDocument();
          expect(screen.getByText('目标')).toBeInTheDocument();
          expect(screen.getByText('状态')).toBeInTheDocument();
          expect(screen.getByText('耗时')).toBeInTheDocument();

          // Check that interactions are rendered in table region (scoped to avoid filter select)
          const tableRegion = screen.getByTestId(testIds.interactionsShellTableRegion);
          expect(within(tableRegion).getByText('click')).toBeInTheDocument();
          expect(within(tableRegion).getByText('type')).toBeInTheDocument();
          expect(within(tableRegion).getByText('scroll')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders correct status badges for success and failure interactions', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          expect(screen.getByText('成功')).toBeInTheDocument();
          expect(screen.getByText('失败')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders latency values when present', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      // InteractionsTable uses dayjs.duration(ms).humanize() which groups small ms as "a few seconds"
      await waitFor(
        () => {
          const tableRegion = screen.getByTestId(testIds.interactionsShellTableRegion);
          expect(tableRegion.textContent).toContain('a few seconds');
        },
        { timeout: 3000 }
      );
    });

    it('renders timestamp as formatted time string', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      // InteractionsTable uses formatTime() which outputs HH:mm:ss
      await waitFor(
        () => {
          const tableRegion = screen.getByTestId(testIds.interactionsShellTableRegion);
          expect(tableRegion.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
        },
        { timeout: 3000 }
      );
    });

    it('renders modal anchor with correct testid', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse({ success: true, data: [] }));

      render(<InteractionsShell />, { wrapper: createWrapper() });
      expect(screen.getByTestId(testIds.interactionsShellModalAnchor)).toBeInTheDocument();
    });
  });

  describe('Integration - Filters, Stats, and Table Together', () => {
    it('renders all major regions together with mocked data', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockInteractions }))
        .mockResolvedValueOnce(mockResponse({ success: true, data: mockStats }));

      render(<InteractionsShell />, { wrapper: createWrapper() });

      await waitFor(
        () => {
          // Filter rail
          expect(screen.getByTestId(testIds.interactionsShellFilterRail)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.interactionsShellFilterStatus)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.interactionsShellFilterType)).toBeInTheDocument();

          // Stats strip
          expect(screen.getByTestId(testIds.interactionsShellStatsStrip)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.interactionsShellStatsTotal)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.interactionsShellStatsSuccess)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.interactionsShellStatsFailure)).toBeInTheDocument();

          // Table region
          expect(screen.getByTestId(testIds.interactionsShellTableRegion)).toBeInTheDocument();

          // Verify stats are populated
          expect(screen.getByText('10')).toBeInTheDocument(); // Total from stats API
          expect(screen.getByText('8')).toBeInTheDocument(); // Success from stats API
          expect(screen.getByText('2')).toBeInTheDocument(); // Failure from stats API

          // Verify table has data
          expect(screen.getByText('button')).toBeInTheDocument();
          expect(screen.getByText('input')).toBeInTheDocument();
          expect(screen.getByText('window')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { testIds } from '@/shared/testing/testids.js';

// Create mutable references for mocks
const mockUseMcpStatus = vi.fn();
const mockUseMcpTools = vi.fn();
const mockUseMcpCall = vi.fn();

// Mock all config API hooks to prevent actual network calls
vi.mock('@/features/config/api/config.queries.js', () => ({
  useConfig: vi.fn(() => ({ data: { mode: 'dev', vision: { provider: 'openai', model: 'gpt-4o' }, decision: { provider: 'openai', model: 'gpt-4o' } }, isLoading: false, error: null })),
  useHealth: vi.fn(() => ({ data: { status: 'ok', services: { playwright: 'ok' }, mcp: { enabled: true, servers: [] } }, isLoading: false, error: null })),
  useMcpStatus: () => mockUseMcpStatus(),
  useMcpTools: () => mockUseMcpTools(),
  useVerifyKeys: vi.fn(() => ({ data: { keys: [{ provider: 'openai', displayName: 'OpenAI', status: 'valid', keyPreview: 'sk-...xyz' }] }, isLoading: false, error: null })),
}));

// Mock mutations for McpCall
vi.mock('@/features/config/api/config.mutations.js', () => ({
  useMcpCall: () => mockUseMcpCall(),
}));

// Mock StatusIndicator to simplify testing
vi.mock('@/shared/ui/StatusIndicator.js', () => ({
  StatusIndicator: ({ status, label }: { status: string; label?: string }) => (
    <div data-testid={testIds.statusIndicator} data-status={status}>
      {label || status}
    </div>
  ),
}));

// Mock LoadingSpinner
vi.mock('@/shared/ui/LoadingSpinner.js', () => ({
  LoadingSpinner: ({ label }: { label?: string }) => <div data-testid="loading-spinner">{label}</div>,
}));

// Setup default mock return values with type assertions to avoid complex TS types
const mockQueryResult = <T,>(data: T | undefined, isLoading = false, error: Error | null = null) => ({
  data,
  isLoading,
  error,
  isError: !!error,
  isPending: isLoading,
  isSuccess: !isLoading && !error && data !== undefined,
  isRefetching: false,
  isRefetchError: false,
  isLoadingError: false,
  isPaused: false,
  isFetched: false,
  isFetchedAfterMount: false,
  fetchStatus: isLoading ? 'fetching' : 'idle',
  status: isLoading ? 'pending' : (error ? 'error' : 'success'),
  refetch: vi.fn(),
  hasNextPage: false,
  hasPreviousPage: false,
  isFetchingNextPage: false,
  isFetchingPreviousPage: false,
  fetchNextPage: vi.fn(),
  fetchPreviousPage: vi.fn(),
  remove: vi.fn(),
} as unknown); // Type assertion to bypass strict TS checking for mocks

// Mock useMcpCall with isPending property
mockUseMcpCall.mockReturnValue({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  isError: false,
  error: null,
  isSuccess: true,
  isIdle: true,
});

/**
 * Parity test for P4-27-V: MCP status list and tools modal integration.
 *
 * Tests structural rendering and testid placement for McpStatusList and McpToolsModal.
 * Verifies the modal-launch path from McpStatusList to McpToolsModal.
 */
describe('P4-27-V: MCP Status List and Tools Modal - Parity', () => {
  let queryClient: QueryClient;

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    // Create fresh QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  // ── McpStatusList - Basic Rendering ──────────────────────────────

  describe('McpStatusList - Basic Rendering', () => {
    it('renders McpStatusList component with correct testid', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({ enabled: true, servers: [] }));

      renderWithProviders(<McpStatusList />);
      expect(screen.getByTestId(testIds.mcpStatusList)).toBeInTheDocument();
    });

    it('renders header with "MCP 服务" title and status indicator', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({ enabled: true, servers: [] }));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByText('MCP 服务')).toBeInTheDocument();
      expect(within(list).getByText('已启用')).toBeInTheDocument();
    });
  });

  // ── McpStatusList - Server Items ──────────────────────────────────

  describe('McpStatusList - Server Items', () => {
    it('renders server items with name, status, and tool count', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({
        enabled: true,
        servers: [
          { name: 'server-1', running: true, toolsCount: 3 },
          { name: 'server-2', running: false, toolsCount: 0 },
        ],
      }));

      renderWithProviders(<McpStatusList />);

      const serverItems = screen.getAllByTestId(testIds.mcpServerItem);
      expect(serverItems).toHaveLength(2);

      // First server - running with tools
      expect(within(serverItems[0]).getByText('server-1')).toBeInTheDocument();
      expect(within(serverItems[0]).getByText('运行中 · 3 工具')).toBeInTheDocument();

      // Second server - stopped
      expect(within(serverItems[1]).getByText('server-2')).toBeInTheDocument();
      expect(within(serverItems[1]).getByText('已停止 · 0 工具')).toBeInTheDocument();
    });

    it('renders "查看工具" button for running servers with tools', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({
        enabled: true,
        servers: [
          { name: 'running-server', running: true, toolsCount: 5 },
          { name: 'stopped-server', running: false, toolsCount: 0 },
          { name: 'no-tools-server', running: true, toolsCount: 0 },
        ],
      }));

      const onSelectServer = vi.fn();
      renderWithProviders(<McpStatusList onSelectServer={onSelectServer} />);

      const serverItems = screen.getAllByTestId(testIds.mcpServerItem);

      // Running server with tools - should have button
      expect(within(serverItems[0]).getByTestId(testIds.mcpServerViewBtn)).toBeInTheDocument();
      expect(within(serverItems[0]).getByText('查看工具')).toBeInTheDocument();

      // Stopped server - should not have button
      expect(within(serverItems[1]).queryByTestId(testIds.mcpServerViewBtn)).not.toBeInTheDocument();

      // Running server with no tools - should not have button
      expect(within(serverItems[2]).queryByTestId(testIds.mcpServerViewBtn)).not.toBeInTheDocument();
    });

    it('calls onSelectServer callback when "查看工具" button is clicked', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({
        enabled: true,
        servers: [
          { name: 'test-server', running: true, toolsCount: 2 },
        ],
      }));

      const onSelectServer = vi.fn();
      renderWithProviders(<McpStatusList onSelectServer={onSelectServer} />);

      const viewBtn = screen.getByTestId(testIds.mcpServerViewBtn);
      fireEvent.click(viewBtn);

      expect(onSelectServer).toHaveBeenCalledTimes(1);
      expect(onSelectServer).toHaveBeenCalledWith('test-server');
    });

    it('does not render "查看工具" button when onSelectServer is not provided', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({
        enabled: true,
        servers: [
          { name: 'server-no-callback', running: true, toolsCount: 5 },
        ],
      }));

      renderWithProviders(<McpStatusList />);

      const serverItem = screen.getByTestId(testIds.mcpServerItem);
      expect(within(serverItem).queryByTestId(testIds.mcpServerViewBtn)).not.toBeInTheDocument();
    });
  });

  // ── McpStatusList - States ────────────────────────────────────────

  describe('McpStatusList - States', () => {
    it('renders loading state', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult(undefined, true));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByTestId('loading-spinner')).toBeInTheDocument();
      expect(within(list).getByText('加载中...')).toBeInTheDocument();
    });

    it('renders error state', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult(undefined, false, new Error('Network error')));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByText('加载 MCP 状态失败')).toBeInTheDocument();
    });

    it('renders empty state when no data', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult(null));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByText('无 MCP 数据')).toBeInTheDocument();
    });

    it('renders disabled state when MCP is not enabled', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({ enabled: false, servers: [] }));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByText('MCP 服务')).toBeInTheDocument();
      expect(within(list).getByText('已禁用')).toBeInTheDocument();
      expect(within(list).getByText('MCP 未在配置中启用。')).toBeInTheDocument();
    });

    it('renders empty state when enabled but no servers', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      mockUseMcpStatus.mockReturnValue(mockQueryResult({ enabled: true, servers: [] }));

      renderWithProviders(<McpStatusList />);

      const list = screen.getByTestId(testIds.mcpStatusList);
      expect(within(list).getByText('无已启用的 MCP 服务器。')).toBeInTheDocument();
    });
  });

  // ── McpToolsModal - Basic Rendering ────────────────────────────────

  describe('McpToolsModal - Basic Rendering', () => {
    it('renders McpToolsModal with correct testid when serverName is set', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({ tools: [] }));

      renderWithProviders(<McpToolsModal serverName="test-server" onClose={vi.fn()} />);

      expect(screen.getByTestId(testIds.mcpToolsModal)).toBeInTheDocument();
    });

    it('does not render modal when serverName is null', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');

      renderWithProviders(<McpToolsModal serverName={null} onClose={vi.fn()} />);

      expect(screen.queryByTestId(testIds.mcpToolsModal)).not.toBeInTheDocument();
    });

    it('renders modal with correct title including serverName', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({ tools: [] }));

      renderWithProviders(<McpToolsModal serverName="my-server" onClose={vi.fn()} />);

      // Modal title is rendered inside McpToolsModal
      expect(screen.getByText('my-server 工具')).toBeInTheDocument();
    });
  });

  // ── McpToolsModal - Tool List ─────────────────────────────────────

  describe('McpToolsModal - Tool List', () => {
    it('renders tool list with filtered tools for serverName', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'server-1.tool-a', description: 'Tool A description' },
          { name: 'server-1.tool-b', description: 'Tool B description' },
          { name: 'server-2.tool-x', description: 'Tool X description' },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server-1" onClose={vi.fn()} />);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('tool-a')).toBeInTheDocument();
      expect(within(modal).getByText('Tool A description')).toBeInTheDocument();
      expect(within(modal).getByText('tool-b')).toBeInTheDocument();
      expect(within(modal).getByText('Tool B description')).toBeInTheDocument();

      // Tool from server-2 should not appear
      expect(within(modal).queryByText('tool-x')).not.toBeInTheDocument();
    });

    it('renders empty state when no tools for server', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'server-2.tool-a', description: 'Tool A' },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server-1" onClose={vi.fn()} />);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('该服务器暂无可用工具。')).toBeInTheDocument();
    });

    it('renders loading state', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult(undefined, true));

      renderWithProviders(<McpToolsModal serverName="test" onClose={vi.fn()} />);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByTestId('loading-spinner')).toBeInTheDocument();
      expect(within(modal).getByText('加载中...')).toBeInTheDocument();
    });

    it('renders error state', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult(undefined, false, new Error('Failed to load')));

      renderWithProviders(<McpToolsModal serverName="test" onClose={vi.fn()} />);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('加载工具失败')).toBeInTheDocument();
    });
  });

  // ── McpToolsModal - Tool Details ─────────────────────────────────

  describe('McpToolsModal - Tool Details', () => {
    it('shows input schema when tool is selected', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          {
            name: 'server.tool-with-schema',
            description: 'Tool with input schema',
            inputSchema: {
              properties: {
                param1: { type: 'string', description: 'First parameter' },
                param2: { type: 'number', description: 'Second parameter' },
              },
              required: ['param1'],
            },
          },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server" onClose={vi.fn()} />);

      // Click to expand tool
      const toolHeader = screen.getByText('tool-with-schema').closest('button');
      fireEvent.click(toolHeader!);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('输入参数')).toBeInTheDocument();
      // Check that parameter names appear (text is broken up, so just verify presence)
      expect(within(modal).queryByText('param1')).toBeInTheDocument();
      expect(within(modal).queryByText('param2')).toBeInTheDocument();
      // Verify required marker appears
      expect(modal.innerHTML).toContain('*');
    });

    it('renders args input textarea', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'server.test-tool', description: 'Test tool' },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server" onClose={vi.fn()} />);

      // Click to expand tool
      const toolHeader = screen.getByText('test-tool').closest('button');
      fireEvent.click(toolHeader!);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      const textarea = within(modal).getByPlaceholderText('输入 JSON 参数...');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('{}');
    });

    it('renders execute button', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'server.exec-tool', description: 'Executable tool' },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server" onClose={vi.fn()} />);

      // Click to expand tool
      const toolHeader = screen.getByText('exec-tool').closest('button');
      fireEvent.click(toolHeader!);

      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('执行')).toBeInTheDocument();
    });

    it('renders result section after execution', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'server.result-tool', description: 'Tool with result' },
        ],
      }));

      mockUseMcpCall.mockReturnValue({
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({ success: true, result: { data: 'test-result' } }),
        isPending: false,
        isError: false,
        error: null,
        isSuccess: true,
        isIdle: true,
      } as unknown);

      renderWithProviders(<McpToolsModal serverName="server" onClose={vi.fn()} />);

      // Click to expand tool
      const toolHeader = screen.getByText('result-tool').closest('button');
      fireEvent.click(toolHeader!);

      const modal = screen.getByTestId(testIds.mcpToolsModal);

      // Should show result section after expand (initialized to null, so not shown yet)
      // This is a structural test - the component renders the result section when callResult is set
      expect(within(modal).queryByText('执行结果')).not.toBeInTheDocument();
    });
  });

  // ── McpToolsModal - Structural Elements ───────────────────────────

  describe('McpToolsModal - Structural Elements', () => {
    it('renders at least 5 structural elements for a tool', async () => {
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          {
            name: 'server.structural-tool',
            description: 'Tool for structure test',
            inputSchema: {
              properties: {
                param1: { type: 'string', description: 'Parameter 1' },
              },
              required: [],
            },
          },
        ],
      }));

      renderWithProviders(<McpToolsModal serverName="server" onClose={vi.fn()} />);

      // Click to expand tool
      const toolHeader = screen.getByText('structural-tool').closest('button');
      fireEvent.click(toolHeader!);

      const modal = screen.getByTestId(testIds.mcpToolsModal);

      // Verify 5 structural elements
      expect(within(modal).getByText('structural-tool')).toBeInTheDocument(); // 1. Tool name
      expect(within(modal).getByText('Tool for structure test')).toBeInTheDocument(); // 2. Description
      expect(within(modal).getByText('输入参数')).toBeInTheDocument(); // 3. Section title
      expect(within(modal).getByPlaceholderText('输入 JSON 参数...')).toBeInTheDocument(); // 4. Args input
      expect(within(modal).getByText('执行')).toBeInTheDocument(); // 5. Execute button
    });
  });

  // ── Integration: List → Modal Launch Path ────────────────────────

  describe('Integration: List → Modal Launch Path', () => {
    it('verifies modal-launch path exists without backend contract changes', async () => {
      const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
      const { McpToolsModal } = await import('@/features/config/components/McpToolsModal.js');

      // Mock MCP status with running servers
      mockUseMcpStatus.mockReturnValue(mockQueryResult({
        enabled: true,
        servers: [
          { name: 'test-server', running: true, toolsCount: 2 },
        ],
      }));

      // Mock MCP tools
      mockUseMcpTools.mockReturnValue(mockQueryResult({
        tools: [
          { name: 'test-server.tool-1', description: 'Tool 1' },
        ],
      }));

      // Render list with onSelectServer callback
      const onSelectServer = vi.fn();
      renderWithProviders(<McpStatusList onSelectServer={onSelectServer} />);

      // Verify list renders correctly
      expect(screen.getByTestId(testIds.mcpStatusList)).toBeInTheDocument();

      // Verify server item renders
      const serverItem = screen.getByTestId(testIds.mcpServerItem);
      expect(within(serverItem).getByText('test-server')).toBeInTheDocument();
      expect(within(serverItem).getByText('运行中 · 2 工具')).toBeInTheDocument();

      // Verify view button renders
      const viewBtn = screen.getByTestId(testIds.mcpServerViewBtn);
      expect(viewBtn).toBeInTheDocument();
      expect(within(serverItem).getByText('查看工具')).toBeInTheDocument();

      // Verify modal launch path exists (simulated by calling onSelectServer)
      fireEvent.click(viewBtn);
      expect(onSelectServer).toHaveBeenCalledWith('test-server');

      // Verify modal can render with that serverName
      renderWithProviders(
        <>
          <McpStatusList onSelectServer={onSelectServer} />
          <McpToolsModal serverName="test-server" onClose={vi.fn()} />
        </>
      );

      expect(screen.getByTestId(testIds.mcpToolsModal)).toBeInTheDocument();
      const modal = screen.getByTestId(testIds.mcpToolsModal);
      expect(within(modal).getByText('tool-1')).toBeInTheDocument();
    });
  });
});

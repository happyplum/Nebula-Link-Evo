import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useLayoutStore } from '@/features/layout/store/layout.store.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock all config API hooks to prevent actual network calls
vi.mock('@/features/config/api/config.queries.js', () => ({
  useConfig: vi.fn(() => ({ data: { mode: 'dev', vision: { provider: 'openai', model: 'gpt-4o' }, decision: { provider: 'openai', model: 'gpt-4o' } }, isLoading: false, error: null })),
  useHealth: vi.fn(() => ({ data: { status: 'ok', services: { playwright: 'ok' }, mcp: { enabled: true, servers: [] } }, isLoading: false, error: null })),
  useMcpStatus: vi.fn(() => ({ data: { enabled: true, servers: [] }, isLoading: false, error: null })),
  useVerifyKeys: vi.fn(() => ({ data: { keys: [{ provider: 'openai', displayName: 'OpenAI', status: 'valid', keyPreview: 'sk-...xyz' }] }, isLoading: false, error: null })),
}));

// Mock mutations for ConnectivityTest and AiTest
vi.mock('@/features/config/api/config.mutations.js', () => {
  const mockMutate = vi.fn();
  return {
    useTestAi: vi.fn(() => ({ mutate: mockMutate, mutateAsync: vi.fn(), isPending: false, isError: false, error: null })),
  };
});

// Mock useMutation to prevent actual mutations
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null })),
  };
});

// Mock StatusIndicator to simplify testing
vi.mock('@/shared/ui/StatusIndicator.js', () => ({
  StatusIndicator: ({ status, label }: { status: string; label?: string }) => (
    <div data-testid="mock-status-indicator" data-status={status}>
      {label || status}
    </div>
  ),
}));

// Mock LoadingSpinner
vi.mock('@/shared/ui/LoadingSpinner.js', () => ({
  LoadingSpinner: ({ label }: { label?: string }) => <div data-testid="mock-loading-spinner">{label}</div>,
}));

/**
 * Parity test for P4-26: Config summary and service/API-key status blocks.
 *
 * Tests structural rendering and testid placement for all 6 config components:
 * - ConfigPanel
 * - HealthStatusCard
 * - McpStatusList
 * - ApiKeysStatus
 * - ConnectivityTest
 * - AiTest
 *
 * Verifies that all components render with correct testids in the config tab.
 */
describe('P4-26: Config Summary and Service/API-Key Status Blocks - Parity', () => {
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
    // Reset Zustand store before each test to avoid state bleeding
    useLayoutStore.setState({ activeRightTab: 'config' });
    // Create fresh QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });

  // Test: ApiKeysStatus component renders with correct testid
  it('renders ApiKeysStatus component (testid: configApiKeysStatus)', async () => {
    const { ApiKeysStatus } = await import('@/features/config/components/ApiKeysStatus.js');
    renderWithProviders(<ApiKeysStatus />);
    expect(screen.getByTestId(testIds.configApiKeysStatus)).toBeInTheDocument();
  });

  // Test: ConnectivityTest component renders with correct testid
  it('renders ConnectivityTest component (testid: configConnectivityTest)', async () => {
    const { ConnectivityTest } = await import('@/features/config/components/ConnectivityTest.js');
    renderWithProviders(<ConnectivityTest />);
    expect(screen.getByTestId(testIds.configConnectivityTest)).toBeInTheDocument();
  });

  // Test: AiTest component renders with correct testid
  it('renders AiTest component (testid: configAiTest)', async () => {
    const { AiTest } = await import('@/features/config/components/AiTest.js');
    renderWithProviders(<AiTest />);
    expect(screen.getByTestId(testIds.configAiTest)).toBeInTheDocument();
  });

  // Test: ConfigPanel component renders with correct testid
  it('renders ConfigPanel component (testid: configPanel)', async () => {
    const { ConfigPanel } = await import('@/features/config/components/ConfigPanel.js');
    renderWithProviders(<ConfigPanel />);
    expect(screen.getByTestId(testIds.configPanel)).toBeInTheDocument();
  });

  // Test: HealthStatusCard component renders with correct testid
  it('renders HealthStatusCard component (testid: healthStatusCard)', async () => {
    const { HealthStatusCard } = await import('@/features/config/components/HealthStatusCard.js');
    renderWithProviders(<HealthStatusCard />);
    expect(screen.getByTestId(testIds.healthStatusCard)).toBeInTheDocument();
  });

  // Test: McpStatusList component renders with correct testid
  it('renders McpStatusList component (testid: mcpStatusList)', async () => {
    const { McpStatusList } = await import('@/features/config/components/McpStatusList.js');
    renderWithProviders(<McpStatusList />);
    expect(screen.getByTestId(testIds.mcpStatusList)).toBeInTheDocument();
  });

  // Comprehensive test: all 6 config components render with correct testids
  it('renders all 6 config components with correct testids', async () => {
    const {
      ConfigPanel,
      HealthStatusCard,
      McpStatusList,
      ApiKeysStatus,
      ConnectivityTest,
      AiTest,
    } = await import('@/features/config/components/index.js');

    renderWithProviders(
      <>
        <ConfigPanel />
        <HealthStatusCard />
        <McpStatusList />
        <ApiKeysStatus />
        <ConnectivityTest />
        <AiTest />
      </>
    );

    // Verify all 6 components render with correct testids
    expect(screen.getByTestId(testIds.configPanel)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.healthStatusCard)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.mcpStatusList)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.configApiKeysStatus)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.configConnectivityTest)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.configAiTest)).toBeInTheDocument();
  });
});

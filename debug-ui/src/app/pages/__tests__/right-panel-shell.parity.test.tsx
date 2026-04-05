import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from '../DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';
import { useLayoutStore } from '@/features/layout/store/layout.store.js';
import fs from 'node:fs';
import path from 'node:path';

// Mock useDebugSocket to prevent actual WebSocket connections
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: vi.fn(() => ({
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  })),
}));

// Mock useDebugSession to prevent actual API calls
vi.mock('@/features/runtime/hooks/useDebugSession.js', () => ({
  useDebugSession: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

// Mock LiveViewCanvas to avoid canvas rendering issues in JSDOM
vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

// Mock useQuery hooks for ControlPanel and history components
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null })),
    useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  };
});

// Mock PlaywrightControlContext provider
vi.mock('@/features/playwright-control/context/PlaywrightControlContext.js', () => ({
  PlaywrightControlProvider: ({ children }: { children: React.ReactNode }) => children,
  usePlaywrightControl: vi.fn(() => ({
    selectedElement: null,
    actions: [],
    setSelectedElement: vi.fn(),
  })),
}));

// Mock useNavigate before importing DebugPage
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Right Panel Shell Parity Test', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeAll(() => {
    // Inject CSS variables into jsdom document
    const cssPath = path.resolve(__dirname, '../../../styles/variables.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
  });

  beforeEach(() => {
    // Reset store to default state before each test
    useLayoutStore.setState({ activeActivityIcon: 'monitor' });
    useLayoutStore.setState({ activeRightTab: 'dom-elements' });
  });

  it('asserts exactly 2 tab buttons render with correct labels', () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    // Verify both tab buttons exist with correct labels
    const domElementsTab = rightPanelContent.getByRole('tab', { name: '📍 DOM Elements' });
    const configTab = rightPanelContent.getByRole('tab', { name: '⚙️ 配置' });

    expect(domElementsTab).toBeInTheDocument();
    expect(configTab).toBeInTheDocument();

    // Verify tab buttons have correct aria attributes
    expect(domElementsTab).toHaveAttribute('aria-selected', 'true');
    expect(configTab).toHaveAttribute('aria-selected', 'false');
  });

  it('asserts right-panel tab content shells have correct data-testids', async () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    // Verify DOM Elements tab content (default active tab)
    expect(rightPanelContent.getByTestId(testIds.rightPanelTabDomElements)).toBeInTheDocument();

    // Click Config tab to switch
    const configTab = rightPanelContent.getByRole('tab', { name: '⚙️ 配置' });
    fireEvent.click(configTab);

    // Verify Config tab content now renders
    await waitFor(() => {
      expect(rightPanelContent.getByTestId(testIds.configContent)).toBeInTheDocument();
    });
  });

  it('asserts no placeholder text in right panel', () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    // Check for common placeholder phrases (case-insensitive)
    const placeholderPhrases = ['placeholder', 'coming soon', 'TODO', 'TODO:', 'Coming Soon', 'Placeholder'];

    placeholderPhrases.forEach((phrase) => {
      expect(rightPanelContent.queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
    });
  });

  it('asserts DOM Elements tab renders without placeholder content', () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    const domElementsTab = rightPanelContent.getByTestId(testIds.rightPanelTabDomElements);

    // Check for placeholder phrases within DOM Elements tab only
    const placeholderPhrases = ['placeholder', 'coming soon', 'TODO', 'TODO:', 'Coming Soon', 'Placeholder'];

    placeholderPhrases.forEach((phrase) => {
      expect(within(domElementsTab).queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
    });
  });

  it('asserts Config tab renders without placeholder content', async () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    // Click Config tab to switch
    const configTabButton = rightPanelContent.getByRole('tab', { name: '⚙️ 配置' });
    fireEvent.click(configTabButton);

    // Now Config tab content should be rendered
    await waitFor(() => {
      const configTab = rightPanelContent.getByTestId(testIds.configContent);

      // Check for placeholder phrases within Config tab only
      const placeholderPhrases = ['placeholder', 'coming soon', 'TODO', 'TODO:', 'Coming Soon', 'Placeholder'];

      placeholderPhrases.forEach((phrase) => {
        expect(within(configTab).queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
      });
    });
  });

  it('asserts DOM Elements tab renders expected content', () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    const domElementsTab = rightPanelContent.getByTestId(testIds.rightPanelTabDomElements);

    expect(within(domElementsTab).getByTestId(testIds.domElementsTable)).toBeInTheDocument();
  });

  it('asserts Config tab renders expected config content', async () => {
    renderWithProviders(<DebugPage />);

    const rightPanel = screen.getByTestId(testIds.debugRightPanel);
    const rightPanelContent = within(rightPanel);

    // Click Config tab to switch
    const configTabButton = rightPanelContent.getByRole('tab', { name: '⚙️ 配置' });
    fireEvent.click(configTabButton);

    // Now Config tab content should be rendered
    await waitFor(() => {
      const configTab = rightPanelContent.getByTestId(testIds.configContent);
      expect(within(configTab).getByTestId(testIds.configPanel)).toBeInTheDocument();
      expect(within(configTab).getByTestId(testIds.healthStatusCard)).toBeInTheDocument();
    });
  });
});

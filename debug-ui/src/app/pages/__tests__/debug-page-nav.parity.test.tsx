import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from '../DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';
import { useLayoutStore } from '@/features/layout/store/layout.store.js';
import fs from 'node:fs';
import path from 'node:path';

// Mock useDebugSocket to prevent actual WebSocket connections
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: vi.fn(),
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

describe('DebugPage Navigation Parity Test', () => {
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

  it('asserts 6 activity buttons render with correct data-testid values', () => {
    renderWithProviders(<DebugPage />);

    // Verify all 6 activity buttons are present with correct testids
    expect(screen.getByTestId(testIds.activityBtnMonitor)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnControl)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnAi)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnChat)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnHistory)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnInteractions)).toBeInTheDocument();
  });

  it('asserts buttons are in legacy order: monitor, control, ai, chat, history, interactions', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    expect(buttons.length).toBe(6);

    // Verify order by checking data-testid
    expect(buttons[0]).toHaveAttribute('data-testid', testIds.activityBtnMonitor);
    expect(buttons[1]).toHaveAttribute('data-testid', testIds.activityBtnControl);
    expect(buttons[2]).toHaveAttribute('data-testid', testIds.activityBtnAi);
    expect(buttons[3]).toHaveAttribute('data-testid', testIds.activityBtnChat);
    expect(buttons[4]).toHaveAttribute('data-testid', testIds.activityBtnHistory);
    expect(buttons[5]).toHaveAttribute('data-testid', testIds.activityBtnInteractions);
  });

  it('asserts Chat button has special behavior (navigates to /chat)', () => {
    // Reset the mock before this test
    mockNavigate.mockClear();

    renderWithProviders(<DebugPage />);

    const chatButton = screen.getByTestId(testIds.activityBtnChat);

    // Use fireEvent.click for proper React event handling
    fireEvent.click(chatButton);

    // Chat button should navigate to /chat
    expect(mockNavigate).toHaveBeenCalledWith('/chat');
  });

  it('asserts non-chat buttons call setActiveIcon', () => {
    renderWithProviders(<DebugPage />);

    // Get non-chat buttons
    const monitorButton = screen.getByTestId(testIds.activityBtnMonitor);
    const controlButton = screen.getByTestId(testIds.activityBtnControl);
    const aiButton = screen.getByTestId(testIds.activityBtnAi);
    const historyButton = screen.getByTestId(testIds.activityBtnHistory);
    const interactionsButton = screen.getByTestId(testIds.activityBtnInteractions);

    // Click each button and verify store state changes
    monitorButton.click();
    expect(useLayoutStore.getState().activeActivityIcon).toBe('monitor');

    controlButton.click();
    expect(useLayoutStore.getState().activeActivityIcon).toBe('control');

    aiButton.click();
    expect(useLayoutStore.getState().activeActivityIcon).toBe('ai');

    historyButton.click();
    expect(useLayoutStore.getState().activeActivityIcon).toBe('history');

    interactionsButton.click();
    expect(useLayoutStore.getState().activeActivityIcon).toBe('interactions');
  });

  it('asserts activity button icons render correctly', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    // Verify emoji icons render in order
    expect(buttons[0]).toHaveTextContent('📊'); // monitor
    expect(buttons[1]).toHaveTextContent('🎮'); // control
    expect(buttons[2]).toHaveTextContent('🤖'); // ai
    expect(buttons[3]).toHaveTextContent('💬'); // chat
    expect(buttons[4]).toHaveTextContent('📋'); // history
    expect(buttons[5]).toHaveTextContent('🖱️'); // interactions
  });

  it('asserts activity button titles render correctly', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    // Verify title attributes render correctly
    expect(buttons[0]).toHaveAttribute('title', '状态'); // monitor
    expect(buttons[1]).toHaveAttribute('title', '控制'); // control
    expect(buttons[2]).toHaveAttribute('title', 'AI'); // ai
    expect(buttons[3]).toHaveAttribute('title', '对话测试'); // chat
    expect(buttons[4]).toHaveAttribute('title', '历史'); // history
    expect(buttons[5]).toHaveAttribute('title', '交互'); // interactions
  });
});

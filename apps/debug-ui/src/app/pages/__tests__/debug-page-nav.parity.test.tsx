import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from '../DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';
import { useLayoutStore } from '@/features/layout/store/layout.store.js';
import fs from 'node:fs';
import path from 'node:path';

// Mock useDebugSession to prevent actual API calls
vi.mock('@/features/runtime/hooks/useDebugSession.js', () => ({
  useDebugSession: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

// Mock LiveViewCanvas to avoid canvas rendering issues in JSDOM
vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

// Mock LiveKitView to avoid ResizeObserver in JSDOM
vi.mock('@/features/liveview/components/LiveKitView.js', () => ({
  LiveKitView: () => <div data-testid="mock-livekit-view">LiveKitView</div>,
}));

// Also mock the barrel export that MonitorMainShell uses
vi.mock('@/features/liveview/components/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/liveview/components/index.js')>();
  return {
    ...actual,
    LiveKitView: () => <div data-testid="mock-livekit-view">LiveKitView</div>,
  };
});

// Mock useQuery hooks for ControlPanel and execution components
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null })),
    useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
    useQueries: vi.fn(() => []),
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
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../../../styles/variables.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
  });

  beforeEach(() => {
    mockNavigate.mockClear();
    useLayoutStore.setState({ activeActivityIcon: 'monitor' });
  });

  it('asserts 3 activity buttons render with correct data-testid values', () => {
    renderWithProviders(<DebugPage />);

    expect(screen.getByTestId(testIds.activityBtnMonitor)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnControl)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.activityBtnAi)).toBeInTheDocument();
  });

  it('asserts buttons are in order: monitor, control, ai', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    expect(buttons.length).toBe(3);

    expect(buttons[0]).toHaveAttribute('data-testid', testIds.activityBtnMonitor);
    expect(buttons[1]).toHaveAttribute('data-testid', testIds.activityBtnControl);
    expect(buttons[2]).toHaveAttribute('data-testid', testIds.activityBtnAi);
  });

  it('asserts activity buttons call setActiveIcon', () => {
    renderWithProviders(<DebugPage />);

    const monitorButton = screen.getByTestId(testIds.activityBtnMonitor);
    const controlButton = screen.getByTestId(testIds.activityBtnControl);
    const aiButton = screen.getByTestId(testIds.activityBtnAi);

    fireEvent.click(monitorButton);
    expect(useLayoutStore.getState().activeActivityIcon).toBe('monitor');

    fireEvent.click(controlButton);
    expect(useLayoutStore.getState().activeActivityIcon).toBe('control');

    fireEvent.click(aiButton);
    expect(useLayoutStore.getState().activeActivityIcon).toBe('ai');
  });

  it('asserts activity button icons render correctly', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    expect(buttons[0]).toHaveTextContent('📊');
    expect(buttons[1]).toHaveTextContent('🎮');
    expect(buttons[2]).toHaveTextContent('🤖');
  });

  it('asserts activity button titles render correctly', () => {
    renderWithProviders(<DebugPage />);

    const activityBar = screen.getByTestId(testIds.activityBar);
    const buttons = activityBar.querySelectorAll('button');

    expect(buttons[0]).toHaveAttribute('title', '状态');
    expect(buttons[1]).toHaveAttribute('title', '控制');
    expect(buttons[2]).toHaveAttribute('title', 'AI');
  });
});

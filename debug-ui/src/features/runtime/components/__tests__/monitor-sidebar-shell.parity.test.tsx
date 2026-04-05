import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MonitorSidebarShell } from '../MonitorSidebarShell.js';
import { testIds } from '@/shared/testing/testids.js';
import fs from 'node:fs';
import path from 'node:path';

// Mock hooks and components to prevent side effects
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: vi.fn(() => ({
    sendMessage: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    singleStep: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  })),
}));

vi.mock('@/features/playwright-control/api/control.adapters.js', () => ({
  takeScreenshot: vi.fn(() => Promise.resolve({ success: true })),
  fetchDomSnapshot: vi.fn(() => Promise.resolve({ success: true, dom: null })),
}));

vi.mock('@/features/playwright-control/api/control.adapters.js', () => ({
  takeScreenshot: vi.fn(() => Promise.resolve({ success: true, screenshot: 'data:image/png;base64,test' })),
  fetchDomSnapshot: vi.fn(() => Promise.resolve({ success: true, dom: null })),
}));

vi.mock('@/features/runtime/hooks/useDebugSession.js', () => ({
  useDebugSession: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: null, isLoading: false, error: null })),
    useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
  };
});

vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('MonitorSidebarShell Parity Test', () => {
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
    const cssPath = path.resolve(__dirname, '../../../../styles/variables.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
  });

  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders shell with correct testid', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const shell = screen.getByTestId(testIds.monitorSidebar);
    expect(shell).toBeInTheDocument();
  });

  it('renders all 3 cards with correct testids', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const wsCard = screen.getByTestId(testIds.monitorSidebarWsCard);
    const browserCard = screen.getByTestId(testIds.monitorSidebarBrowserCard);
    const screenshotCard = screen.getByTestId(testIds.monitorSidebarScreenshotCard);

    expect(wsCard).toBeInTheDocument();
    expect(browserCard).toBeInTheDocument();
    expect(screenshotCard).toBeInTheDocument();
  });

  it('renders WebSocket status indicators with correct testids', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const wsCard = screen.getByTestId(testIds.monitorSidebarWsCard);
    const wsIndicator = within(wsCard).getByTestId(testIds.statusIndicator);
    const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);

    expect(wsIndicator).toBeInTheDocument();
    expect(wsStatusText).toBeInTheDocument();
    expect(wsStatusText).toHaveTextContent('未连接');
  });

  it('renders browser status indicators with correct testids', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const browserCard = screen.getByTestId(testIds.monitorSidebarBrowserCard);
    const browserIndicator = within(browserCard).getByTestId(testIds.statusIndicator);
    const browserStatusText = screen.getByTestId(testIds.monitorSidebarBrowserStatusText);

    expect(browserIndicator).toBeInTheDocument();
    expect(browserStatusText).toBeInTheDocument();
    expect(browserStatusText).toHaveTextContent('未知');
  });

  it('renders WebSocket card buttons with correct labels and testids', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const refreshBtn = screen.getByTestId(testIds.monitorSidebarWsRefreshBtn);
    const stepBtn = screen.getByTestId(testIds.monitorSidebarWsStepBtn);
    const pauseBtn = screen.getByTestId(testIds.monitorSidebarWsPauseBtn);
    const resumeBtn = screen.getByTestId(testIds.monitorSidebarWsResumeBtn);

    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveTextContent('刷新');

    expect(stepBtn).toBeInTheDocument();
    expect(stepBtn).toHaveTextContent('单步');

    expect(pauseBtn).toBeInTheDocument();
    expect(pauseBtn).toHaveTextContent('暂停');

    expect(resumeBtn).toBeInTheDocument();
    expect(resumeBtn).toHaveTextContent('恢复');
  });

  it('renders browser card button with correct label and testid', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const screenshotBtn = screen.getByTestId(testIds.monitorSidebarBrowserScreenshotBtn);

    expect(screenshotBtn).toBeInTheDocument();
    expect(screenshotBtn).toHaveTextContent('截图');
  });

  it('renders DOM screenshot card with correct testids and content', () => {
    renderWithProviders(<MonitorSidebarShell />);

    const snapshotLabel = screen.getByTestId(testIds.monitorSidebarSnapshotLabel);
    const snapshotImg = screen.getByTestId(testIds.monitorSidebarSnapshotImg);
    const refreshBtn = screen.getByTestId(testIds.monitorSidebarSnapshotRefreshBtn);

    expect(snapshotLabel).toBeInTheDocument();
    expect(snapshotLabel).toHaveTextContent('ID: —');

    expect(snapshotImg).toBeInTheDocument();
    expect(snapshotImg).toHaveTextContent('暂无截图');

    expect(refreshBtn).toBeInTheDocument();
    expect(refreshBtn).toHaveTextContent('刷新 DOM 截图');
  });

  it('asserts card titles are present', () => {
    renderWithProviders(<MonitorSidebarShell />);

    expect(screen.getByText('WebSocket 状态')).toBeInTheDocument();
    expect(screen.getByText('浏览器状态')).toBeInTheDocument();
    expect(screen.getByText('DOM 截图 (Annotated)')).toBeInTheDocument();
  });

  it('asserts at least 5 key structural elements have correct testids', () => {
    renderWithProviders(<MonitorSidebarShell />);

    // Verify 5 key structural elements with testids
    expect(screen.getByTestId(testIds.monitorSidebar)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarWsCard)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarBrowserCard)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarScreenshotCard)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarWsRefreshBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarBrowserScreenshotBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.monitorSidebarSnapshotRefreshBtn)).toBeInTheDocument();
  });
});

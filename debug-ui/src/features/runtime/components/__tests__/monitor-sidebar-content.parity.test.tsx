import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MonitorSidebarShell } from '../MonitorSidebarShell.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { testIds } from '@/shared/testing/testids.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * P3-16-V Monitor Sidebar Content Parity Tests
 *
 * Verifies that MonitorSidebarShell renders correct status text for all states:
 * - WebSocket status: connected ('已连接'), disconnected ('未连接'), connecting ('连接中...'), reconnecting ('重连中...')
 * - Browser status: ready ('就绪'), unhealthy ('异常'), unknown ('未知')
 * - Snapshot version: displays version number or '—' when null/0
 * - Zustand store is reset between tests to prevent state leakage
 */

// Mock hooks and components to prevent side effects
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: () => ({
    sendMessage: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    singleStep: vi.fn(),
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  }),
}));

vi.mock('@/features/playwright-control/api/control.adapters.js', () => ({
  takeScreenshot: vi.fn(() => Promise.resolve({ success: true, screenshot: 'data:image/png;base64,test' })),
  fetchDomSnapshot: vi.fn(() => Promise.resolve({ success: true, dom: null })),
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

describe('P3-16-V MonitorSidebarShell - Content Parity', () => {
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
    // Reset Zustand store before each test to prevent state leakage
    useRuntimeStore.getState().reset();
  });

  describe('WebSocket Status Card', () => {
    it('shows "未连接" when connectionStatus is disconnected', () => {
      useRuntimeStore.getState().setConnectionStatus('disconnected');
      renderWithProviders(<MonitorSidebarShell />);

      const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);
      expect(wsStatusText).toHaveTextContent('未连接');
    });

    it('shows "已连接" when connectionStatus is connected', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      renderWithProviders(<MonitorSidebarShell />);

      const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);
      expect(wsStatusText).toHaveTextContent('已连接');
    });

    it('shows "连接中..." when connectionStatus is connecting', () => {
      useRuntimeStore.getState().setConnectionStatus('connecting');
      renderWithProviders(<MonitorSidebarShell />);

      const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);
      expect(wsStatusText).toHaveTextContent('连接中...');
    });

    it('shows "重连中..." when connectionStatus is reconnecting', () => {
      useRuntimeStore.getState().setConnectionStatus('reconnecting');
      renderWithProviders(<MonitorSidebarShell />);

      const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);
      expect(wsStatusText).toHaveTextContent('重连中...');
    });
  });

  describe('Browser Status Card', () => {
    it('shows "未知" when playwrightStatus is unknown (default)', () => {
      useRuntimeStore.getState().setPlaywrightStatus('unknown');
      renderWithProviders(<MonitorSidebarShell />);

      const browserStatusText = screen.getByTestId(testIds.monitorSidebarBrowserStatusText);
      expect(browserStatusText).toHaveTextContent('未知');
    });

    it('shows "就绪" when playwrightStatus is ready', () => {
      useRuntimeStore.getState().setPlaywrightStatus('ready');
      renderWithProviders(<MonitorSidebarShell />);

      const browserStatusText = screen.getByTestId(testIds.monitorSidebarBrowserStatusText);
      expect(browserStatusText).toHaveTextContent('就绪');
    });

    it('shows "异常" when playwrightStatus is unhealthy', () => {
      useRuntimeStore.getState().setPlaywrightStatus('unhealthy');
      renderWithProviders(<MonitorSidebarShell />);

      const browserStatusText = screen.getByTestId(testIds.monitorSidebarBrowserStatusText);
      expect(browserStatusText).toHaveTextContent('异常');
    });
  });

  describe('DOM Screenshot Card', () => {
    it('shows "ID: —" when snapshot info is empty', () => {
      useRuntimeStore.getState().reset();
      renderWithProviders(<MonitorSidebarShell />);

      const snapshotLabel = screen.getByTestId(testIds.monitorSidebarSnapshotLabel);
      expect(snapshotLabel).toHaveTextContent('ID: —');
    });

    it('still shows empty snapshot id when only local version counter changes to 1', () => {
      useRuntimeStore.getState().incrementSnapshotVersion();
      renderWithProviders(<MonitorSidebarShell />);

      const snapshotLabel = screen.getByTestId(testIds.monitorSidebarSnapshotLabel);
      expect(snapshotLabel).toHaveTextContent('ID: —');
    });

    it('still shows empty snapshot id when only local version counter changes to 42', () => {
      for (let i = 0; i < 42; i++) {
        useRuntimeStore.getState().incrementSnapshotVersion();
      }
      renderWithProviders(<MonitorSidebarShell />);

      const snapshotLabel = screen.getByTestId(testIds.monitorSidebarSnapshotLabel);
      expect(snapshotLabel).toHaveTextContent('ID: —');
    });

    it('shows empty snapshot id when version counter is reset to default', () => {
      for (let i = 0; i < 10; i++) {
        useRuntimeStore.getState().incrementSnapshotVersion();
      }
      useRuntimeStore.getState().reset();
      renderWithProviders(<MonitorSidebarShell />);

      const snapshotLabel = screen.getByTestId(testIds.monitorSidebarSnapshotLabel);
      expect(snapshotLabel).toHaveTextContent('ID: —');
    });
  });

  describe('Zustand Store Isolation', () => {
    it('ensures tests do not affect each other via store state leakage', () => {
      // First test: set connected
      useRuntimeStore.getState().setConnectionStatus('connected');
      useRuntimeStore.getState().setPlaywrightStatus('ready');
      for (let i = 0; i < 5; i++) {
        useRuntimeStore.getState().incrementSnapshotVersion();
      }

      renderWithProviders(<MonitorSidebarShell />);

      expect(screen.getByTestId(testIds.monitorSidebarWsStatusText)).toHaveTextContent('已连接');
      expect(screen.getByTestId(testIds.monitorSidebarBrowserStatusText)).toHaveTextContent('就绪');
      expect(screen.getByTestId(testIds.monitorSidebarSnapshotLabel)).toHaveTextContent('ID: —');
    });

    it('verifies store is reset before each test (default state)', () => {
      // This test should see default state because beforeEach resets store
      renderWithProviders(<MonitorSidebarShell />);

      expect(screen.getByTestId(testIds.monitorSidebarWsStatusText)).toHaveTextContent('未连接');
      expect(screen.getByTestId(testIds.monitorSidebarBrowserStatusText)).toHaveTextContent('未知');
      expect(screen.getByTestId(testIds.monitorSidebarSnapshotLabel)).toHaveTextContent('ID: —');
    });
  });

  describe('Structural Testids Parity', () => {
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

    it('renders WebSocket status text with correct testid', () => {
      renderWithProviders(<MonitorSidebarShell />);

      const wsStatusText = screen.getByTestId(testIds.monitorSidebarWsStatusText);
      expect(wsStatusText).toBeInTheDocument();
      expect(wsStatusText).toHaveTextContent('未连接');
    });

    it('renders browser status text with correct testid', () => {
      renderWithProviders(<MonitorSidebarShell />);

      const browserStatusText = screen.getByTestId(testIds.monitorSidebarBrowserStatusText);
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

      expect(screen.getByTestId(testIds.monitorSidebar)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarWsCard)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarBrowserCard)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarScreenshotCard)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarWsRefreshBtn)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarBrowserScreenshotBtn)).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorSidebarSnapshotRefreshBtn)).toBeInTheDocument();
    });
  });
});

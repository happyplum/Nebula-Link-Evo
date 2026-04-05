import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from './DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock the WebSocket hook to prevent actual connections during tests
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: vi.fn(() => ({
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => () => {}),
  })),
}));

// Mock the LiveViewCanvas to avoid canvas rendering issues in JSDOM
vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

describe('DebugShell Integration', () => {
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

  it('renders the debug shell with all main areas', () => {
    renderWithProviders(<DebugPage />);
    
    // Check main shell container
    expect(screen.getByTestId(testIds.debugShell)).toBeInTheDocument();
    
    // Check activity bar icons
    expect(screen.getByTitle('状态')).toBeInTheDocument();
    expect(screen.getByTitle('控制')).toBeInTheDocument();
    expect(screen.getByTitle('AI')).toBeInTheDocument();
    expect(screen.getByTitle('对话测试')).toBeInTheDocument();
    
    // Check sidebar header
    expect(screen.getByText('🌌 Nebula Debug')).toBeInTheDocument();
    
    // Monitor is default activity, so monitor-main should render
    expect(screen.getByTestId(testIds.monitorMain)).toBeInTheDocument();
    
    // Check right panel tabs
    expect(screen.getByRole('tab', { name: '📍 DOM Elements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '⚙️ 配置' })).toBeInTheDocument();
  });

  it('switches sidebar content when activity icons are clicked', () => {
    renderWithProviders(<DebugPage />);
    
    // Default is Monitor panel
    expect(screen.getByText('状态')).toBeInTheDocument();
    
    // Click Control
    fireEvent.click(screen.getByTitle('控制'));
    expect(screen.getByRole('button', { name: /浏览器基础/i })).toBeInTheDocument();
    
    // Click History
    fireEvent.click(screen.getByTitle('历史'));
    expect(screen.getByTestId(testIds.historyShell)).toBeInTheDocument();
  });
});

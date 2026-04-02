import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from './DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock the WebSocket hook to prevent actual connections during tests
vi.mock('@/features/runtime/hooks/useDebugSocket.js', () => ({
  useDebugSocket: vi.fn(),
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
    expect(screen.getByTitle('Control')).toBeInTheDocument();
    expect(screen.getByTitle('Config')).toBeInTheDocument();
    expect(screen.getByTitle('History')).toBeInTheDocument();
    expect(screen.getByTitle('Chat')).toBeInTheDocument();
    
    // Check sidebar header
    expect(screen.getByText('🌌 Nebula Debug')).toBeInTheDocument();
    
    // Check main area
    expect(screen.getByText('Live View')).toBeInTheDocument();
    expect(screen.getByTestId('mock-liveview-canvas')).toBeInTheDocument();
    
    // Check right panel tabs
    expect(screen.getByText('Decisions')).toBeInTheDocument();
    expect(screen.getByText('Interactions')).toBeInTheDocument();
    expect(screen.getByText('AI Log')).toBeInTheDocument();
  });

  it('switches sidebar content when activity icons are clicked', () => {
    renderWithProviders(<DebugPage />);
    
    // Default is Control panel
    expect(screen.getByText('Control')).toBeInTheDocument();
    
    // Click Config
    fireEvent.click(screen.getByTitle('Config'));
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    
    // Click History
    fireEvent.click(screen.getByTitle('History'));
    expect(screen.getByText('History')).toBeInTheDocument();
  });
});

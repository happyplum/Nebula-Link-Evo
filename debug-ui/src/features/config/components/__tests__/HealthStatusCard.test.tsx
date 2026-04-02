import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthStatusCard } from '../HealthStatusCard.js';
import { useHealth } from '../../api/config.queries.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useHealth: vi.fn(),
}));

describe('HealthStatusCard', () => {
  it('renders loading state', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<HealthStatusCard />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as any);

    render(<HealthStatusCard />);
    expect(screen.getByText('Failed to load health status')).toBeInTheDocument();
  });

  it('renders empty state when no health data', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);

    render(<HealthStatusCard />);
    expect(screen.getByText('No health data available')).toBeInTheDocument();
  });

  it('renders health data correctly', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: {
        status: 'ok',
        config: 'ok',
        mcp: {
          enabled: true,
          servers: [{ name: 'test-server', running: true, toolsCount: 5 }],
        },
        services: {
          playwright: 'ok',
        },
        websocketConnections: 2,
      },
      isLoading: false,
      error: null,
    } as any);

    render(<HealthStatusCard />);
    
    expect(screen.getByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('1 servers')).toBeInTheDocument();
  });

  it('renders unhealthy state correctly', () => {
    vi.mocked(useHealth).mockReturnValue({
      data: {
        status: 'error',
        config: 'ok',
        mcp: {
          enabled: false,
          servers: [],
        },
        services: {
          playwright: 'error',
        },
        websocketConnections: 0,
      },
      isLoading: false,
      error: null,
    } as any);

    render(<HealthStatusCard />);
    
    expect(screen.getByText('Issues Detected')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('0 active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});

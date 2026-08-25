import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthStatusCard } from '../HealthStatusCard.js';
import { useHealth } from '../../api/config.queries.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useHealth: vi.fn(),
}));

const useHealthMock = vi.mocked(useHealth) as unknown as {
  mockReturnValue: (value: unknown) => void;
};

describe('HealthStatusCard', () => {
  it('renders loading state', () => {
useHealthMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown);

    render(<HealthStatusCard />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
useHealthMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as unknown);

    render(<HealthStatusCard />);
    expect(screen.getByText('Failed to load health status')).toBeInTheDocument();
  });

  it('renders empty state when no health data', () => {
useHealthMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown);

    render(<HealthStatusCard />);
    expect(screen.getByText('No health data available')).toBeInTheDocument();
  });

  it('renders health data correctly', () => {
useHealthMock.mockReturnValue({
      data: {
        status: 'healthy',
        config: 'ok',
        mcp: {
          enabled: true,
          servers: [{ name: 'test-server', running: true, toolsCount: 5 }],
        },
        services: {
          playwright: 'ok',
        },
      },
      isLoading: false,
      error: null,
    } as unknown);

    render(<HealthStatusCard />);

    expect(screen.getByText('服务状态')).toBeInTheDocument();
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText('1 servers')).toBeInTheDocument();
  });

  it('renders unhealthy state correctly', () => {
useHealthMock.mockReturnValue({
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
      },
      isLoading: false,
      error: null,
    } as unknown);

    render(<HealthStatusCard />);

    expect(screen.getByText('异常')).toBeInTheDocument();
    expect(screen.getByText('未连接')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});

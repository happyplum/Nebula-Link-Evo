import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigPanel } from '../ConfigPanel.js';
import { useConfig } from '../../api/config.queries.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useConfig: vi.fn(),
}));

const useConfigMock = vi.mocked(useConfig) as unknown as {
  mockReturnValue: (value: unknown) => void;
};

describe('ConfigPanel', () => {
  it('renders loading state', () => {
useConfigMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown);

    render(<ConfigPanel />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
useConfigMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as unknown);

    render(<ConfigPanel />);
    expect(screen.getByText('配置加载失败')).toBeInTheDocument();
  });

  it('renders empty state when no config', () => {
useConfigMock.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as unknown);

    render(<ConfigPanel />);
    expect(screen.getByText('暂无配置数据')).toBeInTheDocument();
  });

  it('renders config data correctly', () => {
useConfigMock.mockReturnValue({
      data: {
        mode: 'development',
        decision: { provider: 'anthropic', model: 'claude-3-opus' },
      },
      isLoading: false,
      error: null,
    } as unknown);

    render(<ConfigPanel />);

    expect(screen.getByText('系统配置')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('决策模型')).toBeInTheDocument();
    expect(screen.getByText('claude-3-opus')).toBeInTheDocument();
  });

  it('renders fallback text for missing config values', () => {
useConfigMock.mockReturnValue({
      data: {},
      isLoading: false,
      error: null,
    } as unknown);

    render(<ConfigPanel />);

    expect(screen.getByText('未知')).toBeInTheDocument();
    expect(screen.getAllByText('未配置')).toHaveLength(2);
  });
});

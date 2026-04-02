import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigPanel } from '../ConfigPanel.js';
import { useConfig } from '../../api/config.queries.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useConfig: vi.fn(),
}));

describe('ConfigPanel', () => {
  it('renders loading state', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<ConfigPanel />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as any);

    render(<ConfigPanel />);
    expect(screen.getByText('Failed to load configuration')).toBeInTheDocument();
  });

  it('renders empty state when no config', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);

    render(<ConfigPanel />);
    expect(screen.getByText('No configuration available')).toBeInTheDocument();
  });

  it('renders config data correctly', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: {
        mode: 'development',
        vision: { provider: 'openai', model: 'gpt-4-vision' },
        decision: { provider: 'anthropic', model: 'claude-3-opus' },
      },
      isLoading: false,
      error: null,
    } as any);

    render(<ConfigPanel />);
    
    expect(screen.getByText('System Configuration')).toBeInTheDocument();
    expect(screen.getByText('development')).toBeInTheDocument();
    expect(screen.getByText('openai / gpt-4-vision')).toBeInTheDocument();
    expect(screen.getByText('anthropic / claude-3-opus')).toBeInTheDocument();
  });

  it('renders fallback text for missing config values', () => {
    vi.mocked(useConfig).mockReturnValue({
      data: {},
      isLoading: false,
      error: null,
    } as any);

    render(<ConfigPanel />);
    
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('Not configured')).toHaveLength(2);
  });
});

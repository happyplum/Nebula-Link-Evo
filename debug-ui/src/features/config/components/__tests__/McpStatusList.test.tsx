import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McpStatusList } from '../McpStatusList.js';
import { useMcpStatus } from '../../api/config.queries.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useMcpStatus: vi.fn(),
}));

describe('McpStatusList', () => {
  it('renders loading state', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('Failed to load MCP status')).toBeInTheDocument();
  });

  it('renders empty state when no data', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('No MCP data available')).toBeInTheDocument();
  });

  it('renders disabled state', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: false,
        servers: [],
      },
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Model Context Protocol is disabled in configuration.')).toBeInTheDocument();
  });

  it('renders empty servers list', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [],
      },
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('No MCP servers configured or discovered.')).toBeInTheDocument();
  });

  it('renders servers list and handles view tools click', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [
          { name: 'server-1', running: true, toolsCount: 5 },
          { name: 'server-2', running: false, toolsCount: 0 },
        ],
      },
      isLoading: false,
      error: null,
    } as any);

    const onSelectServer = vi.fn();
    render(<McpStatusList onSelectServer={onSelectServer} />);
    
    expect(screen.getByText('server-1')).toBeInTheDocument();
    expect(screen.getByText('5 tools')).toBeInTheDocument();
    
    expect(screen.getByText('server-2')).toBeInTheDocument();
    expect(screen.getByText('0 tools')).toBeInTheDocument();

    const viewButton = screen.getByText('View Tools');
    fireEvent.click(viewButton);
    
    expect(onSelectServer).toHaveBeenCalledWith('server-1');
  });
});

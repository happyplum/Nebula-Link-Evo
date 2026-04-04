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
    expect(screen.getByText('加载 MCP 状态失败')).toBeInTheDocument();
  });

  it('renders empty state when no data', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('无 MCP 数据')).toBeInTheDocument();
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
    expect(screen.getByText('已禁用')).toBeInTheDocument();
    expect(screen.getByText('MCP 未在配置中启用。')).toBeInTheDocument();
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
    expect(screen.getByText('已启用')).toBeInTheDocument();
    expect(screen.getByText('无已启用的 MCP 服务器。')).toBeInTheDocument();
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
    expect(screen.getByText('运行中 · 5 工具')).toBeInTheDocument();
    
    expect(screen.getByText('server-2')).toBeInTheDocument();
    expect(screen.getByText('已停止 · 0 工具')).toBeInTheDocument();

    const viewButton = screen.getByText('查看工具');
    fireEvent.click(viewButton);
    
    expect(onSelectServer).toHaveBeenCalledWith('server-1');
  });
});

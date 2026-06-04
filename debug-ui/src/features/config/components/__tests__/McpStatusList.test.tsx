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

  it('renders servers with state machine states and handles view tools click', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [
          { name: 'browser-control', running: true, state: 'running' as const, toolsCount: 15 },
          { name: 'vision-server', running: false, state: 'stopped' as const, toolsCount: 0 },
        ],
      },
      isLoading: false,
      error: null,
    } as any);

    const onSelectServer = vi.fn();
    render(<McpStatusList onSelectServer={onSelectServer} />);

    expect(screen.getByText('browser-control')).toBeInTheDocument();
    expect(screen.getByText('运行中 · 15 工具')).toBeInTheDocument();

    expect(screen.getByText('vision-server')).toBeInTheDocument();
    expect(screen.getByText('已停止 · 0 工具')).toBeInTheDocument();

    const viewButton = screen.getByText('查看工具');
    fireEvent.click(viewButton);

    expect(onSelectServer).toHaveBeenCalledWith('browser-control');
  });

  it('renders reconnecting state with loading indicator', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [
          { name: 'browser-control', running: false, state: 'reconnecting' as const, toolsCount: 0 },
        ],
      },
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('重连中 · 0 工具')).toBeInTheDocument();
    // No view button when not running
    expect(screen.queryByText('查看工具')).not.toBeInTheDocument();
  });

  it('renders failed state with error indicator', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [
          { name: 'browser-control', running: false, state: 'failed' as const, toolsCount: 0 },
        ],
      },
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('失败 · 0 工具')).toBeInTheDocument();
  });

  it('renders starting state with loading indicator', () => {
    vi.mocked(useMcpStatus).mockReturnValue({
      data: {
        enabled: true,
        servers: [
          { name: 'browser-control', running: false, state: 'starting' as const, toolsCount: 0 },
        ],
      },
      isLoading: false,
      error: null,
    } as any);

    render(<McpStatusList />);
    expect(screen.getByText('启动中 · 0 工具')).toBeInTheDocument();
  });
});

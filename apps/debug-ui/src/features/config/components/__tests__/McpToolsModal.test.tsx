import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpToolsModal } from '../McpToolsModal.js';
import { useMcpTools } from '../../api/config.queries.js';
import { useMcpCall } from '../../api/config.mutations.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/config.queries.js', () => ({
  useMcpTools: vi.fn(),
}));

vi.mock('../../api/config.mutations.js', () => ({
  useMcpCall: vi.fn(),
}));

const useMcpCallMock = vi.mocked(useMcpCall) as unknown as {
  mockReturnValue: (value: unknown) => void;
};
const useMcpToolsMock = vi.mocked(useMcpTools) as unknown as {
  mockReturnValue: (value: unknown) => void;
};

describe('McpToolsModal', () => {
  const mockMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useMcpCallMock.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as unknown);
  });

  it('does not render when serverName is null', () => {
    useMcpToolsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown);

    render(<McpToolsModal serverName={null} onClose={() => {}} />);
    expect(screen.queryByTestId(testIds.mcpToolsModal)).not.toBeInTheDocument();
  });

  it('renders loading state', () => {
    useMcpToolsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown);

    render(<McpToolsModal serverName="test-server" onClose={() => {}} />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders error state', () => {
    useMcpToolsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load'),
    } as unknown);

    render(<McpToolsModal serverName="test-server" onClose={() => {}} />);
    expect(screen.getByText('加载工具失败')).toBeInTheDocument();
  });

  it('renders empty state when no tools for server', () => {
    useMcpToolsMock.mockReturnValue({
      data: {
        tools: [{ name: 'other-server.tool1', description: 'desc' }],
      },
      isLoading: false,
      error: null,
    } as unknown);

    render(<McpToolsModal serverName="test-server" onClose={() => {}} />);
    expect(screen.getByText('该服务器暂无可用工具。')).toBeInTheDocument();
  });

  it('renders tools list and handles execution', async () => {
    useMcpToolsMock.mockReturnValue({
      data: {
        tools: [
          {
            name: 'test-server.my-tool',
            description: 'A test tool',
            inputSchema: {
              properties: {
                param1: { type: 'string', description: 'A parameter' },
              },
              required: ['param1'],
            },
          },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown);

    mockMutateAsync.mockResolvedValue({
      success: true,
      result: { message: 'Success!' },
    });

    render(<McpToolsModal serverName="test-server" onClose={() => {}} />);

    // Tool name should be displayed without server prefix
    expect(screen.getByText('my-tool')).toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByText('my-tool'));

    // Description should be visible after expanding
    expect(screen.getByText('A test tool')).toBeInTheDocument();

    // Schema should be visible
    expect(screen.getByText('输入参数')).toBeInTheDocument();
    expect(screen.getByText('param1')).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();

    // Execute section should be visible
    const textarea = screen.getByPlaceholderText('输入 JSON 参数...');
    fireEvent.change(textarea, { target: { value: '{"param1": "value1"}' } });

    const executeButton = screen.getByText('执行');
    fireEvent.click(executeButton);

    expect(mockMutateAsync).toHaveBeenCalledWith({
      server: 'test-server',
      tool: 'my-tool',
      args: { param1: 'value1' },
    });

    await waitFor(() => {
      expect(screen.getByText('执行结果')).toBeInTheDocument();
      expect(screen.getByText(/Success!/)).toBeInTheDocument();
    });
  });

  it('handles invalid JSON input', async () => {
    useMcpToolsMock.mockReturnValue({
      data: {
        tools: [{ name: 'test-server.my-tool', description: 'A test tool' }],
      },
      isLoading: false,
      error: null,
    } as unknown);

    render(<McpToolsModal serverName="test-server" onClose={() => {}} />);

    fireEvent.click(screen.getByText('my-tool'));

    const textarea = screen.getByPlaceholderText('输入 JSON 参数...');
    fireEvent.change(textarea, { target: { value: 'invalid json' } });

    const executeButton = screen.getByText('执行');
    fireEvent.click(executeButton);

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('JSON 参数格式错误')).toBeInTheDocument();
  });
});

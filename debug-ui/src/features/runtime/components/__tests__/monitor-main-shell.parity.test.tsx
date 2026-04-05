import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MonitorMainShell } from '../MonitorMainShell.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-monitor-liveview">LiveViewCanvas</div>,
}));

vi.mock('@/features/runtime/hooks/index.js', () => ({
  useDebugSocket: () => ({
    sendMessage: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
  }),
}));

describe('MonitorMainShell Parity Test', () => {
  it('asserts MonitorMainShell renders with 6 structural regions', () => {
    render(<MonitorMainShell />);

    // Region 1: Header with status badge
    const header = screen.getByTestId(testIds.monitorMainHeader);
    expect(header).toBeInTheDocument();
    expect(within(header).getByTestId(testIds.monitorMainStatusBadge)).toBeInTheDocument();

    // Region 2: Liveview container
    expect(screen.getByTestId(testIds.monitorMainLiveview)).toBeInTheDocument();

    // Region 3: Task strip with indicator, status text, and task ID
    const taskStrip = screen.getByTestId(testIds.monitorMainTaskStrip);
    expect(taskStrip).toBeInTheDocument();
    expect(within(taskStrip).getByTestId(testIds.monitorMainTaskIndicator)).toBeInTheDocument();
    expect(within(taskStrip).getByTestId(testIds.monitorMainTaskStatusText)).toBeInTheDocument();
    expect(within(taskStrip).getByTestId(testIds.monitorMainTaskId)).toBeInTheDocument();

    // Region 4: Quick actions with 4 buttons
    const quickActions = screen.getByTestId(testIds.monitorMainQuickActions);
    expect(quickActions).toBeInTheDocument();
    expect(within(quickActions).getByTestId(testIds.monitorMainStepBtn)).toBeInTheDocument();
    expect(within(quickActions).getByTestId(testIds.monitorMainSendCmdBtn)).toBeInTheDocument();
    expect(within(quickActions).getByTestId(testIds.monitorMainDownloadBtn)).toBeInTheDocument();
    expect(within(quickActions).getByTestId(testIds.monitorMainRefreshBtn)).toBeInTheDocument();

    // Region 5: Command bar with input and execute button
    const commandBar = screen.getByTestId(testIds.monitorMainCommandBar);
    expect(commandBar).toBeInTheDocument();
    expect(within(commandBar).getByTestId(testIds.monitorMainCommandInput)).toBeInTheDocument();
    expect(within(commandBar).getByTestId(testIds.monitorMainExecuteBtn)).toBeInTheDocument();

    // Region 6: Log panel with container and empty state
    const logPanel = screen.getByTestId(testIds.monitorMainLogPanel);
    expect(logPanel).toBeInTheDocument();
    expect(within(logPanel).getByTestId(testIds.monitorMainLogContainer)).toBeInTheDocument();
    expect(within(logPanel).getByTestId(testIds.monitorMainLogEmpty)).toBeInTheDocument();
  });

  it('asserts all structural elements have correct text content', () => {
    render(<MonitorMainShell />);

    // Verify header title
    const header = screen.getByTestId(testIds.monitorMainHeader);
    expect(within(header).getByText('📸 实时监控')).toBeInTheDocument();
    expect(within(header).getByTestId(testIds.monitorMainStatusBadge)).toHaveTextContent(
      '连接中...'
    );

    // Verify task strip text
    const taskStrip = screen.getByTestId(testIds.monitorMainTaskStrip);
    expect(within(taskStrip).getByTestId(testIds.monitorMainTaskStatusText)).toHaveTextContent(
      '空闲'
    );
    expect(within(taskStrip).getByTestId(testIds.monitorMainTaskId)).toHaveTextContent('无任务');

    // Verify quick action buttons
    const quickActions = screen.getByTestId(testIds.monitorMainQuickActions);
    expect(within(quickActions).getByTestId(testIds.monitorMainStepBtn)).toHaveTextContent(
      '单步执行'
    );
    expect(within(quickActions).getByTestId(testIds.monitorMainSendCmdBtn)).toHaveTextContent(
      '发送指令'
    );
    expect(within(quickActions).getByTestId(testIds.monitorMainDownloadBtn)).toHaveTextContent(
      '下载截图'
    );
    expect(within(quickActions).getByTestId(testIds.monitorMainRefreshBtn)).toHaveTextContent(
      '刷新历史'
    );

    // Verify command input placeholder
    const commandInput = screen.getByTestId(testIds.monitorMainCommandInput);
    expect(commandInput).toHaveAttribute('placeholder', '输入指令 (pause/resume/step)...');
    expect(screen.getByTestId(testIds.monitorMainExecuteBtn)).toHaveTextContent('执行');

    // Verify log panel empty state
    expect(screen.getByTestId(testIds.monitorMainLogEmpty)).toHaveTextContent('暂无日志');
  });

  it('asserts root container has correct testid', () => {
    const { container } = render(<MonitorMainShell />);
    expect(container.firstChild).toHaveAttribute('data-testid', testIds.monitorMain);
  });

  it('asserts no placeholder text in structural regions', () => {
    render(<MonitorMainShell />);

    const monitorMain = screen.getByTestId(testIds.monitorMain);
    const monitorMainContent = within(monitorMain);

    // Check for common placeholder phrases (case-insensitive)
    const placeholderPhrases = ['placeholder', 'coming soon', 'TODO', 'TODO:', 'Coming Soon'];

    placeholderPhrases.forEach((phrase) => {
      expect(monitorMainContent.queryByText(new RegExp(phrase, 'i'))).not.toBeInTheDocument();
    });
  });
});

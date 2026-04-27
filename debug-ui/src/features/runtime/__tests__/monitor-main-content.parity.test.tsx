import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MonitorMainShell } from '../components/MonitorMainShell.js';
import { useRuntimeStore } from '../store/runtime.store.js';
import { testIds } from '@/shared/testing/testids.js';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-monitor-liveview">LiveViewCanvas</div>,
}));

vi.mock('@/features/liveview/components/LiveKitView.js', () => ({
  default: () => <div data-testid="mock-monitor-liveview">LiveKitView</div>,
}));

/**
 * P3-17-V Monitor Main Content Parity Tests
 *
 * Verifies MonitorMainShell runtime bindings:
 * - Connection status badge: 未连接/已连接/连接中.../重连中...
 * - Task strip: playwrightStatus labels + legacy current-task placeholder
 * - Quick actions: disabled states based on connection + screenshot data
 * - Command bar: input, placeholder, execute button, disabled when disconnected
 * - Execution log: empty state and log entry rendering
 * - Liveview overlay URL display
 * - Zustand store isolation between tests
 */

const mockSendMessage = vi.fn();
const mockOnMessage = vi.fn(() => () => {});

vi.mock('../hooks/useDebugSocket.js', () => ({
  useDebugSocket: () => ({
    sendMessage: mockSendMessage,
    disconnect: vi.fn(),
    reconnect: vi.fn(),
    onMessage: mockOnMessage,
  }),
}));

describe('P3-17-V MonitorMainShell - Content Parity', () => {
  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../../../styles/variables.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
  });

  beforeEach(() => {
    useRuntimeStore.getState().reset();
    mockSendMessage.mockClear();
    mockOnMessage.mockClear();
    mockOnMessage.mockReturnValue(() => {});
  });

  describe('Connection Status Badge', () => {
    it('shows "未连接" when connectionStatus is disconnected', () => {
      useRuntimeStore.getState().setConnectionStatus('disconnected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStatusBadge)).toHaveTextContent('未连接');
    });

    it('shows "已连接" when connectionStatus is connected', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStatusBadge)).toHaveTextContent('已连接');
    });

    it('shows "连接中..." when connectionStatus is connecting', () => {
      useRuntimeStore.getState().setConnectionStatus('connecting');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStatusBadge)).toHaveTextContent('连接中...');
    });

    it('shows "重连中..." when connectionStatus is reconnecting', () => {
      useRuntimeStore.getState().setConnectionStatus('reconnecting');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStatusBadge)).toHaveTextContent('重连中...');
    });
  });

  describe('Task Strip', () => {
    it('shows "空闲" when playwrightStatus is unknown (default)', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainTaskStatusText)).toHaveTextContent('空闲');
    });

    it('shows "就绪" when playwrightStatus is ready', () => {
      useRuntimeStore.getState().setPlaywrightStatus('ready');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainTaskStatusText)).toHaveTextContent('就绪');
    });

    it('shows "异常" when playwrightStatus is unhealthy', () => {
      useRuntimeStore.getState().setPlaywrightStatus('unhealthy');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainTaskStatusText)).toHaveTextContent('异常');
    });

    it('shows "无任务" for task ID when no active task is present', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainTaskId)).toHaveTextContent('无任务');
    });

    it('keeps legacy "无任务" copy even when snapshotVersion changes', () => {
      useRuntimeStore.getState().incrementSnapshotVersion();
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainTaskId)).toHaveTextContent('无任务');
    });
  });

  describe('Quick Actions', () => {
    it('disables all quick actions when disconnected', () => {
      useRuntimeStore.getState().setConnectionStatus('disconnected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStepBtn)).toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainSendCmdBtn)).toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainDownloadBtn)).toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainRefreshBtn)).toBeDisabled();
    });

    it('enables step, command, and refresh buttons when connected', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainStepBtn)).not.toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainSendCmdBtn)).not.toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainRefreshBtn)).not.toBeDisabled();
    });

    it('disables download button when no screenshot data', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainDownloadBtn)).toBeDisabled();
    });

    it('enables download button when screenshot data exists and connected', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      useRuntimeStore.getState().setLastScreenshotDataUrl('data:image/png;base64,abc');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainDownloadBtn)).not.toBeDisabled();
    });

    it('calls sendMessage("step") when 单步执行 is clicked', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      render(<MonitorMainShell />);

      fireEvent.click(screen.getByTestId(testIds.monitorMainStepBtn));
      expect(mockSendMessage).toHaveBeenCalledWith('step', { taskId: undefined });
    });

    it('calls incrementSnapshotVersion when 刷新历史 is clicked', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      const incrementSpy = vi.spyOn(useRuntimeStore.getState(), 'incrementSnapshotVersion');
      render(<MonitorMainShell />);

      fireEvent.click(screen.getByTestId(testIds.monitorMainRefreshBtn));
      expect(incrementSpy).toHaveBeenCalled();
      incrementSpy.mockRestore();
    });
  });

  describe('Command Bar', () => {
    it('renders command input with correct placeholder', () => {
      render(<MonitorMainShell />);

      const input = screen.getByTestId(testIds.monitorMainCommandInput);
      expect(input).toHaveAttribute('placeholder', '输入指令 (pause/resume/step)...');
    });

    it('disables command input and execute button when disconnected', () => {
      useRuntimeStore.getState().setConnectionStatus('disconnected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainCommandInput)).toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainExecuteBtn)).toBeDisabled();
    });

    it('enables command input and execute button when connected', () => {
      useRuntimeStore.getState().setConnectionStatus('connected');
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainCommandInput)).not.toBeDisabled();
      expect(screen.getByTestId(testIds.monitorMainExecuteBtn)).not.toBeDisabled();
    });

    it('renders 执行 button with correct label', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainExecuteBtn)).toHaveTextContent('执行');
    });
  });

  describe('Execution Log', () => {
    it('shows empty state "暂无日志" when no log entries', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainLogEmpty)).toHaveTextContent('暂无日志');
    });
  });

  describe('Header', () => {
    it('renders header title "📸 实时监控"', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId(testIds.monitorMainHeader)).toHaveTextContent('📸 实时监控');
    });

    it('renders current URL inside liveview header', () => {
      useRuntimeStore.getState().setPlaywrightUrl('https://example.com/page');
      render(<MonitorMainShell />);

      expect(screen.getByText('实时画面')).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorMainLiveview)).toHaveTextContent(
        'https://example.com/page'
      );
    });
  });

  describe('Structural Testids Parity', () => {
    it('renders all 15 monitor-main testids', () => {
      render(<MonitorMainShell />);

      const expected = [
        testIds.monitorMain,
        testIds.monitorMainHeader,
        testIds.monitorMainStatusBadge,
        testIds.monitorMainLiveview,
        testIds.monitorMainTaskStrip,
        testIds.monitorMainTaskIndicator,
        testIds.monitorMainTaskStatusText,
        testIds.monitorMainTaskId,
        testIds.monitorMainQuickActions,
        testIds.monitorMainStepBtn,
        testIds.monitorMainSendCmdBtn,
        testIds.monitorMainDownloadBtn,
        testIds.monitorMainRefreshBtn,
        testIds.monitorMainCommandBar,
        testIds.monitorMainCommandInput,
        testIds.monitorMainExecuteBtn,
        testIds.monitorMainLogPanel,
        testIds.monitorMainLogContainer,
        testIds.monitorMainLogEmpty,
      ];

      expected.forEach((id) => {
        expect(screen.getByTestId(id)).toBeInTheDocument();
      });
    });
  });

  describe('Live view wiring', () => {
    it('renders live view canvas inside the monitor liveview region', () => {
      render(<MonitorMainShell />);

      expect(screen.getByTestId('mock-monitor-liveview')).toBeInTheDocument();
      expect(screen.getByTestId(testIds.monitorMainLiveview)).toContainElement(
        screen.getByTestId('mock-monitor-liveview')
      );
    });
  });
});

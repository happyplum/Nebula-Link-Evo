import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperationLogsShell } from '../components/OperationLogsShell.js';
import type { ConsoleMessage } from '../store/control.store.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock the Zustand store
vi.mock('../store/control.store.js', () => ({
  useControlStore: vi.fn(),
}));

const { useControlStore } = await import('../store/control.store.js');

// Helper to create test messages
const createTestMessage = (type: string, text: string, timestamp: number): ConsoleMessage => ({
  type,
  text,
  timestamp,
});

// Helper to create a timestamp for a specific time
const createTimestamp = (hours: number, minutes: number, seconds: number): number => {
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return date.getTime();
};

describe('OperationLogsShell - Content Parity (P3-20-V)', () => {
  let mockSetConsoleMessages: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockSetConsoleMessages = vi.fn();

    // Default mock implementation
    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });
  });

  it('should render empty state with "暂无日志" message', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText('暂无日志')).toBeInTheDocument();
  });

  it('should render single log entry with formatted timestamp and type', () => {
    const onToggle = vi.fn();
    const timestamp = createTimestamp(14, 30, 45); // 14:30:45

    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [createTestMessage('INFO', '操作成功', timestamp)],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logEntry = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logEntry).toHaveTextContent('[14:30:45]');
    expect(logEntry).toHaveTextContent('INFO');
    expect(logEntry).toHaveTextContent('操作成功');
    expect(logEntry).toBeInTheDocument();
  });

  it('should render multiple log entries in chronological order', () => {
    const onToggle = vi.fn();
    const timestamp1 = createTimestamp(10, 15, 30);
    const timestamp2 = createTimestamp(10, 16, 45);
    const timestamp3 = createTimestamp(10, 18, 0);

    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [
          createTestMessage('INFO', '开始执行', timestamp1),
          createTestMessage('DEBUG', '检查元素', timestamp2),
          createTestMessage('SUCCESS', '操作完成', timestamp3),
        ],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logContainer = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logContainer).toHaveTextContent('[10:15:30]');
    expect(logContainer).toHaveTextContent('INFO');
    expect(logContainer).toHaveTextContent('开始执行');
    expect(logContainer).toHaveTextContent('[10:16:45]');
    expect(logContainer).toHaveTextContent('DEBUG');
    expect(logContainer).toHaveTextContent('检查元素');
    expect(logContainer).toHaveTextContent('[10:18:00]');
    expect(logContainer).toHaveTextContent('SUCCESS');
    expect(logContainer).toHaveTextContent('操作完成');
  });

  it('should format timestamp with single-digit hours/minutes/seconds correctly', () => {
    const onToggle = vi.fn();
    const timestamp = createTimestamp(9, 5, 3); // 09:05:03

    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [createTestMessage('ERROR', '测试失败', timestamp)],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logEntry = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logEntry).toHaveTextContent('[09:05:03]');
    expect(logEntry).toHaveTextContent('ERROR');
    expect(logEntry).toHaveTextContent('测试失败');
    expect(logEntry).toBeInTheDocument();
  });

  it('should call setConsoleMessages with empty array when clear button is clicked', () => {
    const onToggle = vi.fn();
    const timestamp = createTimestamp(12, 0, 0);

    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [createTestMessage('INFO', '测试消息', timestamp)],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const clearButton = screen.getByTestId('control-operation-logs-clear-btn');
    fireEvent.click(clearButton);

    expect(mockSetConsoleMessages).toHaveBeenCalledTimes(1);
    expect(mockSetConsoleMessages).toHaveBeenCalledWith([]);
  });

  it('should call onToggle callback when Accordion title is clicked', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const header = screen.getByTestId('control-operation-logs-header');
    fireEvent.click(header);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('should display clear button text "清空日志"', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText('清空日志')).toBeInTheDocument();
  });

  it('should handle messages with various log types (INFO, DEBUG, ERROR, WARN)', () => {
    const onToggle = vi.fn();
    const timestamp = createTimestamp(8, 30, 0);

    vi.mocked(useControlStore).mockImplementation((selector) => {
      const state = {
        consoleMessages: [
          createTestMessage('INFO', '信息日志', timestamp),
          createTestMessage('DEBUG', '调试日志', timestamp + 1000),
          createTestMessage('ERROR', '错误日志', timestamp + 2000),
          createTestMessage('WARN', '警告日志', timestamp + 3000),
        ],
        selectedElement: null,
        isExecutingAction: false,
        lastActionError: null,
        viewport: null,
        browserOpen: false,
        browserUrl: '',
        setSelectedElement: vi.fn(),
        clearSelectedElement: vi.fn(),
        setConsoleMessages: mockSetConsoleMessages,
        addConsoleMessage: vi.fn(),
        setExecutingAction: vi.fn(),
        setActionError: vi.fn(),
        setViewport: vi.fn(),
        setBrowserOpen: vi.fn(),
        setBrowserUrl: vi.fn(),
        markerToggle: false,
        snapshotId: null,
        domElements: [],
        setMarkerToggle: vi.fn(),
        setSnapshotId: vi.fn(),
        setDomElements: vi.fn(),
        elementPickerEnabled: false,
        highlightedElementId: null,
        capturedCoordinates: null,
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        setCapturedCoordinates: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logContainer = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logContainer).toHaveTextContent('INFO');
    expect(logContainer).toHaveTextContent('信息日志');
    expect(logContainer).toHaveTextContent('DEBUG');
    expect(logContainer).toHaveTextContent('调试日志');
    expect(logContainer).toHaveTextContent('ERROR');
    expect(logContainer).toHaveTextContent('错误日志');
    expect(logContainer).toHaveTextContent('WARN');
    expect(logContainer).toHaveTextContent('警告日志');
  });

  it('should render Accordion with title "📝 操作日志"', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText('📝 操作日志')).toBeInTheDocument();
  });
});

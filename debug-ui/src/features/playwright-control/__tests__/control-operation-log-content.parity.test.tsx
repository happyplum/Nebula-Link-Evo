import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperationLogsShell } from '../components/OperationLogsShell.js';
import type { ConsoleMessage } from '../store/control.store.js';

// Mock the Zustand store
vi.mock('../store/control.store.js', () => ({
  useControlStore: vi.fn(),
}));

const { useControlStore } = await import('../store/control.store.js');

// Helper to create test messages
const createTestMessage = (
  type: string,
  text: string,
  timestamp: number
): ConsoleMessage => ({ type, text, timestamp });

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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });
  });

  it('should render empty state with "等待操作..." message', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText('等待操作...')).toBeInTheDocument();
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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logEntry = screen.getByText(/\[14:30:45\] INFO: 操作成功/);
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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText(/\[10:15:30\] INFO: 开始执行/)).toBeInTheDocument();
    expect(screen.getByText(/\[10:16:45\] DEBUG: 检查元素/)).toBeInTheDocument();
    expect(screen.getByText(/\[10:18:00\] SUCCESS: 操作完成/)).toBeInTheDocument();
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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    const logEntry = screen.getByText(/\[09:05:03\] ERROR: 测试失败/);
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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
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
        setElementPickerEnabled: vi.fn(),
        setHighlightedElementId: vi.fn(),
        reset: vi.fn(),
      };

      return selector(state);
    });

    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText(/INFO: 信息日志/)).toBeInTheDocument();
    expect(screen.getByText(/DEBUG: 调试日志/)).toBeInTheDocument();
    expect(screen.getByText(/ERROR: 错误日志/)).toBeInTheDocument();
    expect(screen.getByText(/WARN: 警告日志/)).toBeInTheDocument();
  });

  it('should render Accordion with title "📝 操作日志"', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell open={true} onToggle={onToggle} />);

    expect(screen.getByText('📝 操作日志')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PageInteractionShell } from '../components/PageInteractionShell.js';
import { testIds } from '@/shared/testing/testids.js';
import { useControlStore } from '../store/control.store.js';
import * as controlAdapters from '../api/control.adapters.js';

/**
 * P3-19-V: Control Page Interaction content parity
 *
 * Verifies PageInteractionShell runtime bindings — Zustand store interactions,
 * adapter calls, disabled state gating, and conditional rendering.
 */

vi.mock('../api/control.adapters.js', () => ({
  executeAction: vi.fn(),
  evaluateExpression: vi.fn(),
  getElements: vi.fn(),
  takeScreenshot: vi.fn(),
  fetchBrowserStatus: vi.fn(),
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  navigateToUrl: vi.fn(),
  getConsoleMessages: vi.fn(),
}));

describe('P3-19-V: Control Page Interaction - Content Parity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useControlStore.getState().reset();
  });

  const enableBrowser = () => {
    useControlStore.getState().setBrowserOpen(true);
  };

  const enableExecuting = () => {
    useControlStore.getState().setExecutingAction(true);
  };

  // --- Disabled state when browser closed ---

  it('disables all interactive controls when browserOpen is false', () => {
    render(<PageInteractionShell />);

    expect(screen.getByTestId(testIds.controlPageInteractionElementPicker)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordX)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordY)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordClick)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionSelectorMode)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionMarkerId)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionActionType)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionExecute)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScrollX)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScrollY)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScroll)).toBeDisabled();
  });

  // --- Enabled state when browser open ---

  it('enables all interactive controls when browserOpen is true', () => {
    enableBrowser();
    render(<PageInteractionShell />);

    expect(screen.getByTestId(testIds.controlPageInteractionElementPicker)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordX)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordY)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionCoordClick)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionSelectorMode)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionMarkerId)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionActionType)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionExecute)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScrollX)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScrollY)).not.toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScroll)).not.toBeDisabled();
  });

  // --- Disabled when isExecutingAction ---

  it('disables all interactive controls when isExecutingAction is true', () => {
    enableBrowser();
    enableExecuting();
    render(<PageInteractionShell />);

    expect(screen.getByTestId(testIds.controlPageInteractionCoordClick)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionExecute)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionScroll)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionElementPicker)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionSelectorMode)).toBeDisabled();
    expect(screen.getByTestId(testIds.controlPageInteractionActionType)).toBeDisabled();
  });

  // --- Coordinate click handler ---

  it('calls executeAction with click action and coordinates when coord click button is clicked', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordX), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordY), {
      target: { value: '200' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionCoordClick));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('click', { x: 100, y: 200 });
    });
  });

  it('calls executeAction with {x:0,y:0} for coord click when inputs are left empty (Number("")===0)', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    render(<PageInteractionShell />);

    // Empty inputs — Number('') === 0, so isNaN guard does NOT trigger
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionCoordClick));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('click', { x: 0, y: 0 });
    });
  });

  // --- Element action in marker mode ---

  it('calls executeAction with markerId when executing element action in marker mode', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    useControlStore.getState().setSnapshotId('snap-1');
    render(<PageInteractionShell />);

    // Default selectorMode is 'marker'
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionMarkerId), {
      target: { value: '42' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionType), {
      target: { value: 'click' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionExecute));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('click', {
        markerId: 42,
        snapshotId: 'snap-1',
      });
    });
  });

  // --- Element action in CSS mode ---

  it('calls executeAction with cssSelector when executing element action in css mode', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    render(<PageInteractionShell />);

    // Switch to CSS mode
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionSelectorMode), {
      target: { value: 'css' },
    });

    // CSS selector input should now be visible
    const cssInput = screen.getByTestId(testIds.controlPageInteractionCssSelector);
    fireEvent.change(cssInput, { target: { value: '.submit-btn' } });

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionType), {
      target: { value: 'type' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionParam), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionExecute));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('type', {
        param: 'hello',
        selector: '.submit-btn',
      });
    });
  });

  // --- Page scroll handler ---

  it('calls executeAction with scroll action and coordinates when scroll button is clicked', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionScrollX), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionScrollY), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionScroll));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('scroll', { x: 0, y: 500 });
    });
  });

  it('calls executeAction with {x:0,y:0} for scroll when inputs are left empty (Number("")===0)', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    render(<PageInteractionShell />);

    // Empty inputs — Number('') === 0, so isNaN guard does NOT trigger
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionScroll));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('scroll', { x: 0, y: 0 });
    });
  });

  // --- Element picker checkbox ---

  it('toggles element picker and updates helper text', () => {
    enableBrowser();
    render(<PageInteractionShell />);

    const picker = screen.getByTestId(testIds.controlPageInteractionElementPicker);
    expect(picker).not.toBeChecked();
    expect(screen.getByText('开启后在实时画面上点击选择元素')).toBeInTheDocument();

    fireEvent.click(picker);
    expect(picker).toBeChecked();
    expect(screen.getByText('点击实时画面选择元素')).toBeInTheDocument();
  });

  // --- Conditional rendering: marker vs CSS selector mode ---

  it('shows marker ID input in marker mode and CSS selector input in css mode', () => {
    enableBrowser();
    render(<PageInteractionShell />);

    // Default: marker mode — marker input present, CSS absent
    expect(screen.getByTestId(testIds.controlPageInteractionMarkerId)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.controlPageInteractionCssSelector)).not.toBeInTheDocument();

    // Switch to CSS mode
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionSelectorMode), {
      target: { value: 'css' },
    });

    // CSS input present, marker input absent
    expect(screen.getByTestId(testIds.controlPageInteractionCssSelector)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.controlPageInteractionMarkerId)).not.toBeInTheDocument();
  });

  // --- Action error on adapter failure ---

  it('sets action error via store when executeAction returns failure', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: false, error: '坐标点击失败' });

    enableBrowser();
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordX), {
      target: { value: '50' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordY), {
      target: { value: '75' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionCoordClick));

    await waitFor(() => {
      expect(useControlStore.getState().lastActionError).toBe('坐标点击失败');
    });
  });

  // --- Action error on adapter exception ---

  it('sets action error via store when executeAction throws exception', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockRejectedValue(new Error('网络异常'));

    enableBrowser();
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionScrollX), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionScrollY), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionScroll));

    await waitFor(() => {
      expect(useControlStore.getState().lastActionError).toBe('网络异常');
    });
  });

  // --- setExecutingAction lifecycle during action ---

  it('sets isExecutingAction true during execution and false after completion', async () => {
    let resolveAction: (value: unknown) => void;
    const actionPromise = new Promise((resolve) => {
      resolveAction = resolve;
    });
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockImplementation(() => actionPromise as Promise<never>);

    enableBrowser();
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordX), {
      target: { value: '1' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionCoordY), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionCoordClick));

    // Should be executing
    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(true);
    });

    // Resolve the action
    resolveAction!({ success: true });

    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  // --- Element action with different action types ---

  it('passes selected action type to executeAction for element operations', async () => {
    const mockExecuteAction = vi.mocked(controlAdapters.executeAction);
    mockExecuteAction.mockResolvedValue({ success: true });

    enableBrowser();
    useControlStore.getState().setSnapshotId('snap-1');
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionMarkerId), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionType), {
      target: { value: 'type' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionParam), {
      target: { value: 'test input' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionExecute));

    await waitFor(() => {
      expect(mockExecuteAction).toHaveBeenCalledWith('type', {
        param: 'test input',
        markerId: 7,
        snapshotId: 'snap-1',
      });
    });
  });

  it('requires param for type/value/dispatch actions', async () => {
    enableBrowser();
    useControlStore.getState().setSnapshotId('snap-1');
    render(<PageInteractionShell />);

    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionMarkerId), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByTestId(testIds.controlPageInteractionActionType), {
      target: { value: 'type' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlPageInteractionExecute));

    await waitFor(() => {
      expect(useControlStore.getState().lastActionError).toBe('当前操作需要参数');
    });
  });
});

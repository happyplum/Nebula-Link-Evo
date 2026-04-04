import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserBasicShell } from '../BrowserBasicShell.js';
import { testIds } from '@/shared/testing/testids.js';
import { useControlStore } from '../../store/control.store.js';
import * as controlAdapters from '../../api/control.adapters.js';

/**
 * Parity test for P3-18-V: Control Browser Basic content parity
 *
 * Tests runtime bindings and state management for BrowserBasicShell.
 * Verifies that component correctly interacts with Zustand store and adapter functions.
 */

// Mock all adapter functions
vi.mock('../../api/control.adapters.js', () => ({
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  navigateToUrl: vi.fn(),
  takeScreenshot: vi.fn(),
  fetchBrowserStatus: vi.fn(),
}));

describe('P3-18-V: Control Browser Basic Shell - Content Parity', () => {
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockOnToggle.mockClear();
    // Reset Zustand store to initial state
    useControlStore.getState().reset();
  });

  it('renders status indicator showing disconnected state initially', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const indicator = screen.getByTestId(testIds.controlBrowserBasicStatusIndicator);
    const statusText = screen.getByTestId(testIds.controlBrowserBasicStatusText);

    expect(indicator).toBeInTheDocument();
    expect(indicator.className).toContain('disconnected');
    expect(statusText).toHaveTextContent('未连接');
  });

  it('renders URL input and navigate button in disabled state when browser is closed', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);

    expect(urlInput).toBeDisabled();
    expect(navigateBtn).toBeDisabled();
    expect(navigateBtn).toHaveTextContent('导航');
  });

  it('renders screenshot button in disabled state when browser is closed', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const screenshotBtn = screen.getByTestId(testIds.controlBrowserBasicScreenshotBtn);

    expect(screenshotBtn).toBeDisabled();
    expect(screenshotBtn).toHaveTextContent('截图');
  });

  it('renders reconnect button enabled even when browser is closed', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const reconnectBtn = screen.getByTestId(testIds.controlBrowserBasicReconnectBtn);

    expect(reconnectBtn).not.toBeDisabled();
    expect(reconnectBtn).toHaveTextContent('重新连接视频流');
  });

  it('updates status indicator to connected after opening browser successfully', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockOpenBrowser).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    const indicator = screen.getByTestId(testIds.controlBrowserBasicStatusIndicator);
    const statusText = screen.getByTestId(testIds.controlBrowserBasicStatusText);
    const currentUrl = screen.getByTestId(testIds.controlBrowserBasicCurrentUrl);

    expect(indicator.className).toContain('connected');
    expect(statusText).toHaveTextContent('已连接');
    expect(currentUrl).toHaveTextContent('https://example.com');
  });

  it('enables URL input and navigate button after browser is opened', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);

    expect(urlInput).not.toBeDisabled();
    // Navigate button requires URL input value to be enabled
    expect(navigateBtn).toBeDisabled();

    // Add URL value and check if navigate button becomes enabled
    fireEvent.change(urlInput, { target: { value: 'example.com' } });
    expect(navigateBtn).not.toBeDisabled();
  });

  it('enables screenshot button after browser is opened', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    const screenshotBtn = screen.getByTestId(testIds.controlBrowserBasicScreenshotBtn);
    expect(screenshotBtn).not.toBeDisabled();
  });

  it('disables close button initially and enables it after browser is opened', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const closeBtn = screen.getByTestId(testIds.controlBrowserBasicCloseBtn);

    // Initially disabled
    expect(closeBtn).toBeDisabled();

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    // Should be enabled after opening
    expect(closeBtn).not.toBeDisabled();
  });

  it('calls navigateToUrl when navigate button is clicked with valid URL', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);
    const mockNavigateToUrl = vi.mocked(controlAdapters.navigateToUrl);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });
    mockNavigateToUrl.mockResolvedValue({ success: true });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    // Open browser first
    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    // Enter URL and click navigate
    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);

    fireEvent.change(urlInput, { target: { value: 'example.com' } });
    fireEvent.click(navigateBtn);

    await waitFor(() => {
      expect(mockNavigateToUrl).toHaveBeenCalledWith('https://example.com');
    });
  });

  it('auto-adds https:// prefix when URL input lacks protocol', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);
    const mockNavigateToUrl = vi.mocked(controlAdapters.navigateToUrl);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });
    mockNavigateToUrl.mockResolvedValue({ success: true });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);

    fireEvent.change(urlInput, { target: { value: 'example.com' } });
    fireEvent.click(navigateBtn);

    await waitFor(() => {
      expect(mockNavigateToUrl).toHaveBeenCalledWith('https://example.com');
    });
  });

  it('calls takeScreenshot when screenshot button is clicked', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);
    const mockTakeScreenshot = vi.mocked(controlAdapters.takeScreenshot);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });
    mockTakeScreenshot.mockResolvedValue({ success: true });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    const screenshotBtn = screen.getByTestId(testIds.controlBrowserBasicScreenshotBtn);
    fireEvent.click(screenshotBtn);

    await waitFor(() => {
      expect(mockTakeScreenshot).toHaveBeenCalled();
    });
  });

  it('calls fetchBrowserStatus when reconnect button is clicked', async () => {
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);

    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    const reconnectBtn = screen.getByTestId(testIds.controlBrowserBasicReconnectBtn);
    fireEvent.click(reconnectBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });
  });

  it('updates current URL display after successful navigation', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);
    const mockNavigateToUrl = vi.mocked(controlAdapters.navigateToUrl);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });
    mockNavigateToUrl.mockResolvedValue({ success: true });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    // Open browser
    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    // Navigate to new URL
    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);

    fireEvent.change(urlInput, { target: { value: 'https://nebula-link.com' } });
    fireEvent.click(navigateBtn);

    await waitFor(() => {
      expect(mockNavigateToUrl).toHaveBeenCalledWith('https://nebula-link.com');
    });

    const currentUrl = screen.getByTestId(testIds.controlBrowserBasicCurrentUrl);
    expect(currentUrl).toHaveTextContent('https://nebula-link.com');
  });

  it('updates status indicator to disconnected after closing browser successfully', async () => {
    const mockOpenBrowser = vi.mocked(controlAdapters.openBrowser);
    const mockFetchStatus = vi.mocked(controlAdapters.fetchBrowserStatus);
    const mockCloseBrowser = vi.mocked(controlAdapters.closeBrowser);

    mockOpenBrowser.mockResolvedValue({ success: true });
    mockFetchStatus.mockResolvedValue({ success: true, isOpen: true, url: 'https://example.com' });
    mockCloseBrowser.mockResolvedValue({ success: true });

    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    // Open browser
    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(mockFetchStatus).toHaveBeenCalled();
    });

    // Verify connected state
    let indicator = screen.getByTestId(testIds.controlBrowserBasicStatusIndicator);
    let statusText = screen.getByTestId(testIds.controlBrowserBasicStatusText);
    expect(indicator.className).toContain('connected');
    expect(statusText).toHaveTextContent('已连接');

    // Close browser
    const closeBtn = screen.getByTestId(testIds.controlBrowserBasicCloseBtn);
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(mockCloseBrowser).toHaveBeenCalled();
    });

    // Verify disconnected state
    indicator = screen.getByTestId(testIds.controlBrowserBasicStatusIndicator);
    statusText = screen.getByTestId(testIds.controlBrowserBasicStatusText);
    const currentUrl = screen.getByTestId(testIds.controlBrowserBasicCurrentUrl);

    expect(indicator.className).toContain('disconnected');
    expect(statusText).toHaveTextContent('未连接');
    expect(currentUrl).toHaveTextContent('-');
  });
});

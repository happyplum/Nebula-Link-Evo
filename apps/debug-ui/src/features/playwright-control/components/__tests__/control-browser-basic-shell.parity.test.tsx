import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserBasicShell } from '@/features/playwright-control/components/BrowserBasicShell.js';
import { testIds } from '@/shared/testing/testids.js';

/**
 * Parity test for P2-09: Control Browser Basic Shell
 *
 * Tests structural rendering and testid placement for BrowserBasicShell.
 * Verifies that the component renders all expected regions with correct testids.
 */
describe('P2-09: Control Browser Basic Shell - Parity', () => {
  const mockOnToggle = vi.fn();

  it('renders the accordion container with correct testid', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    expect(screen.getByTestId(testIds.controlBrowserBasicStatus)).toBeInTheDocument();
  });

  it('renders status indicator with correct testid', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    expect(screen.getByTestId(testIds.controlBrowserBasicStatusIndicator)).toBeInTheDocument();
  });

  it('renders status text with correct testid and content', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const statusText = screen.getByTestId(testIds.controlBrowserBasicStatusText);
    expect(statusText).toBeInTheDocument();
    expect(statusText).toHaveTextContent('未连接');
  });

  it('renders current URL with correct testid and placeholder', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const currentUrl = screen.getByTestId(testIds.controlBrowserBasicCurrentUrl);
    expect(currentUrl).toBeInTheDocument();
    expect(currentUrl).toHaveTextContent('-');
  });

  it('renders open button with correct testid and label', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const openBtn = screen.getByTestId(testIds.controlBrowserBasicOpenBtn);
    expect(openBtn).toBeInTheDocument();
    expect(openBtn).toHaveTextContent('打开');
    // Phase 3 runtime wiring: open button disabled only when browserOpen || isExecuting (both false)
    expect(openBtn).not.toBeDisabled();
  });

  it('renders close button with correct testid and label', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const closeBtn = screen.getByTestId(testIds.controlBrowserBasicCloseBtn);
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn).toHaveTextContent('关闭');
    expect(closeBtn).toBeDisabled();
  });

  it('renders URL input with correct testid and placeholder', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const urlInput = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    expect(urlInput).toBeInTheDocument();
    expect(urlInput).toHaveAttribute('placeholder', 'https://example.com');
    expect(urlInput).toBeDisabled();
  });

  it('renders navigate button with correct testid and label', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const navigateBtn = screen.getByTestId(testIds.controlBrowserBasicNavigateBtn);
    expect(navigateBtn).toBeInTheDocument();
    expect(navigateBtn).toHaveTextContent('导航');
    expect(navigateBtn).toBeDisabled();
  });

  it('renders screenshot button with correct testid and label', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const screenshotBtn = screen.getByTestId(testIds.controlBrowserBasicScreenshotBtn);
    expect(screenshotBtn).toBeInTheDocument();
    expect(screenshotBtn).toHaveTextContent('截图');
    expect(screenshotBtn).toBeDisabled();
  });

  it('renders reconnect button with correct testid and label', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);
    const reconnectBtn = screen.getByTestId(testIds.controlBrowserBasicReconnectBtn);
    expect(reconnectBtn).toBeInTheDocument();
    expect(reconnectBtn).toHaveTextContent('重新连接视频流');
    // Phase 3 runtime wiring: reconnect disabled only when isExecuting (false by default)
    expect(reconnectBtn).not.toBeDisabled();
  });

  it('renders all 10 structural elements with correct testids', () => {
    render(<BrowserBasicShell open={false} onToggle={mockOnToggle} />);

    // Verify all elements exist
    expect(screen.getByTestId(testIds.controlBrowserBasicStatus)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicStatusIndicator)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicStatusText)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicCurrentUrl)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicOpenBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicCloseBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicUrlInput)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicNavigateBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicScreenshotBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.controlBrowserBasicReconnectBtn)).toBeInTheDocument();
  });
});

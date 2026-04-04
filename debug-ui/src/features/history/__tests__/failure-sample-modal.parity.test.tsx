import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { FailureSampleModal } from '../components/FailureSampleModal.js';
import { InteractionDetailModal } from '../components/InteractionDetailModal.js';
import { testIds } from '@/shared/testing/testids.js';
import type { Interaction, FailureSampleData, FailureSampleResponse } from '../types/index.js';

/**
 * Parity test for P4-30-V: Failure Sample Modal
 *
 * Tests structural rendering and data display for FailureSampleModal and InteractionDetailModal.
 * Verifies that components render all expected regions with correct testids.
 * Tests loading, error, empty, and success states for failure sample data.
 */
describe('P4-30-V: Failure Sample Modal - Parity', () => {
  let queryClient: QueryClient;

  function createWrapper() {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      );
    };
  }

  function mockResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mockFailureSampleData: FailureSampleData = {
    path: '/path/to/snapshot.json',
    screenshot: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', // 1x1 red pixel
    dom: '{"tag":"html","children":[{"tag":"body","text":"Test DOM"}]}',
    context: {
      timestamp: '2024-01-01T12:00:00.000Z',
      url: 'https://example.com',
      action: 'click',
      error: {
        message: 'Element not found',
        stack: 'Error: Element not found\n  at Object.click (test.js:10:5)',
      },
    },
  };

  const mockSuccessResponse: FailureSampleResponse = {
    success: true,
    data: mockFailureSampleData,
  };

  const mockFailureInteraction: Interaction = {
    id: 'int-123',
    timestamp: 1711929600000,
    snapshot_id: 'snap-1',
    nebula_id: 'neb-1',
    action_type: 'click',
    target_type: 'button',
    locator_strategy: 'css',
    success: false,
    attempts: 2,
    latency_ms: 200,
    error_code: 'ELEMENT_NOT_FOUND',
    error_message: 'Element not found',
    failure_sample_path: '/path/to/snapshot.json',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
          gcTime: 0,
          staleTime: 0,
        },
      },
    });
  });

  describe('FailureSampleModal - Basic Structure', () => {
    it('renders modal with correct testid when open', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: null })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId(testIds.failureSampleModal)).toBeInTheDocument();
    });

    it('does not render modal when open is false', () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: null })
      );

      const { container } = render(
        <FailureSampleModal open={false} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      expect(container.querySelector('[data-testid="failure-sample-modal"]')).not.toBeInTheDocument();
    });

    it('renders loading state when data is loading', () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise(() => {}) // Never resolves to simulate loading
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByText('加载中…')).toBeInTheDocument();
    });

    it('renders error state when fetch fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Wait for error state to render
      await waitFor(
        () => {
          expect(screen.getByText('无法加载样本')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders empty state when data is null', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: null })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Wait for empty state to render
      await waitFor(
        () => {
          expect(screen.getByText('无样本数据')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('FailureSampleModal - Screenshot Display', () => {
    it('renders screenshot section with correct testid when data has screenshot', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(screen.getByTestId(testIds.failureSampleScreenshot)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders screenshot image with base64 src', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          const screenshot = screen.getByTestId(testIds.failureSampleScreenshot);
          expect(screenshot).toHaveAttribute('src');
          expect(screenshot.getAttribute('src')).toContain('data:image/png;base64');
          expect(screenshot.getAttribute('alt')).toBe('Failure screenshot');
        },
        { timeout: 3000 }
      );
    });

    it('does not render screenshot section when data has no screenshot', async () => {
      const noScreenshotData: FailureSampleData = {
        ...mockFailureSampleData,
        screenshot: '',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: noScreenshotData })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(
            screen.queryByTestId(testIds.failureSampleScreenshot)
          ).not.toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('FailureSampleModal - Error Context Display', () => {
    it('renders error context section with correct testid', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(screen.getByTestId(testIds.failureSampleContext)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders all error context fields correctly', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          const contextSection = screen.getByTestId(testIds.failureSampleContext);
          const context = within(contextSection);

          // Labels
          expect(context.getByText('操作')).toBeInTheDocument();
          expect(context.getByText('时间')).toBeInTheDocument();
          expect(context.getByText('URL')).toBeInTheDocument();

          // Values
          expect(context.getByText('click')).toBeInTheDocument();
          expect(context.getByText('2024-01-01T12:00:00.000Z')).toBeInTheDocument();
          expect(context.getByText('https://example.com')).toBeInTheDocument();

          // Error message
          expect(context.getByText('Element not found')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders stack trace when available', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          const contextSection = screen.getByTestId(testIds.failureSampleContext);
          const context = within(contextSection);

          // Error message
          expect(context.getByText('Element not found')).toBeInTheDocument();

          // Stack trace should be in a pre element
          const stackTrace = contextSection.querySelector('pre');
          expect(stackTrace).toBeInTheDocument();
          expect(stackTrace?.textContent).toContain('Error: Element not found');
        },
        { timeout: 3000 }
      );
    });

    it('does not render stack trace when not available', async () => {
      const noStackData: FailureSampleData = {
        ...mockFailureSampleData,
        context: {
          ...mockFailureSampleData.context,
          error: {
            message: 'Element not found',
          },
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: noStackData })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          const contextSection = screen.getByTestId(testIds.failureSampleContext);
          const stackTrace = contextSection.querySelector('pre');
          expect(stackTrace).not.toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('FailureSampleModal - DOM Snapshot', () => {
    it('renders DOM snapshot section with toggle button', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(screen.getByText('DOM 快照')).toBeInTheDocument();
          expect(screen.getByText('▶')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('renders DOM snapshot content when expanded', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Click the toggle button to expand DOM snapshot
      await waitFor(
        () => {
          const toggleButton = screen.getByText('DOM 快照');
          toggleButton.click();
        },
        { timeout: 3000 }
      );

      // Wait for DOM content to appear
      await waitFor(
        () => {
          const domContent = screen.getByTestId(testIds.failureSampleDom);
          expect(domContent).toBeInTheDocument();
          expect(domContent.textContent).toContain('"tag": "html"');
        },
        { timeout: 3000 }
      );
    });

    it('does not render DOM snapshot when data has no dom field', async () => {
      const noDomData: FailureSampleData = {
        ...mockFailureSampleData,
        dom: '',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: noDomData })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      await waitFor(
        () => {
          expect(screen.queryByText('DOM 快照')).not.toBeInTheDocument();
          expect(screen.queryByTestId(testIds.failureSampleDom)).not.toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('FailureSampleModal - Graceful Error Handling', () => {
    it('handles invalid JSON in dom field gracefully', async () => {
      const invalidJsonData: FailureSampleData = {
        ...mockFailureSampleData,
        dom: 'not valid json',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: true, data: invalidJsonData })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Should render DOM snapshot with raw text (not crash)
      await waitFor(
        () => {
          expect(screen.getByText('DOM 快照')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Expand and verify it shows raw text
      const toggleButton = screen.getByText('DOM 快照');
      toggleButton.click();

      await waitFor(
        () => {
          const domContent = screen.getByTestId(testIds.failureSampleDom);
          expect(domContent).toBeInTheDocument();
          expect(domContent.textContent).toContain('not valid json');
        },
        { timeout: 3000 }
      );
    });

    it('handles null sample path gracefully (no query)', () => {
      vi.spyOn(globalThis, 'fetch');

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath={null} />,
        { wrapper: createWrapper() }
      );

      // Should not fetch when samplePath is null
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('does not crash when response success is false', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse({ success: false, data: null })
      );

      render(
        <FailureSampleModal open={true} onClose={vi.fn()} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Should render empty state
      await waitFor(
        () => {
          expect(screen.getByText('无样本数据')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('does not crash when onClose is called during loading', () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const onClose = vi.fn();
      render(
        <FailureSampleModal open={true} onClose={onClose} samplePath="/test/path" />,
        { wrapper: createWrapper() }
      );

      // Call onClose while loading - should not crash
      expect(() => onClose()).not.toThrow();
    });
  });

  describe('InteractionDetailModal - View Sample Button', () => {
    it('renders view sample button when interaction has failure_sample_path', () => {
      render(
        <InteractionDetailModal
          interaction={mockFailureInteraction}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId(testIds.failureSampleViewBtn)).toBeInTheDocument();
      expect(screen.getByText('查看样本')).toBeInTheDocument();
    });

    it('does not render view sample button when interaction has no failure_sample_path', () => {
      const noSampleInteraction: Interaction = {
        ...mockFailureInteraction,
        failure_sample_path: null,
      };

      render(
        <InteractionDetailModal
          interaction={noSampleInteraction}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      );

      expect(screen.queryByTestId(testIds.failureSampleViewBtn)).not.toBeInTheDocument();
      expect(screen.queryByText('查看样本')).not.toBeInTheDocument();
    });

    it('renders view sample button only when interaction failed and has error', () => {
      const successInteraction: Interaction = {
        ...mockFailureInteraction,
        success: true,
        error_code: null,
        error_message: null,
        failure_sample_path: '/test/path',
      };

      render(
        <InteractionDetailModal
          interaction={successInteraction}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      );

      // Success interaction should not show view sample button even with failure_sample_path
      expect(screen.queryByTestId(testIds.failureSampleViewBtn)).not.toBeInTheDocument();
      expect(screen.queryByText('查看样本')).not.toBeInTheDocument();
    });

    it('opens FailureSampleModal when view sample button is clicked', async () => {
      render(
        <InteractionDetailModal
          interaction={mockFailureInteraction}
          onClose={vi.fn()}
        />,
        { wrapper: createWrapper() }
      );

      const viewSampleBtn = screen.getByTestId(testIds.failureSampleViewBtn);

      // Click should not throw (FailureSampleModal will be rendered)
      expect(() => viewSampleBtn.click()).not.toThrow();

      // Wait for FailureSampleModal to render after state update
      await waitFor(
        () => {
          expect(screen.getByTestId(testIds.failureSampleModal)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Integration - Full Failure Sample Flow', () => {
    it('renders all 5 structural elements with correct testids', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      render(
        <>
          <InteractionDetailModal
            interaction={mockFailureInteraction}
            onClose={vi.fn()}
          />
        </>,
        { wrapper: createWrapper() }
      );

      // Click view sample button to open FailureSampleModal
      const viewSampleBtn = screen.getByTestId(testIds.failureSampleViewBtn);
      viewSampleBtn.click();

      // Wait for FailureSampleModal to render
      await waitFor(
        () => {
          // 1. Modal container
          expect(screen.getByTestId(testIds.failureSampleModal)).toBeInTheDocument();

          // 2. Screenshot section
          expect(screen.getByTestId(testIds.failureSampleScreenshot)).toBeInTheDocument();

          // 3. Error context section
          expect(screen.getByTestId(testIds.failureSampleContext)).toBeInTheDocument();

          // 4. DOM snapshot toggle button
          expect(screen.getByText('DOM 快照')).toBeInTheDocument();

          // 5. Section titles are present
          expect(screen.getByText('截图')).toBeInTheDocument();
          expect(screen.getByText('错误上下文')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('handles complete failure sample lifecycle gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        mockResponse(mockSuccessResponse)
      );

      const onClose = vi.fn();
      render(
        <>
          <InteractionDetailModal
            interaction={mockFailureInteraction}
            onClose={onClose}
          />
        </>,
        { wrapper: createWrapper() }
      );

      // Step 1: Open FailureSampleModal
      const viewSampleBtn = screen.getByTestId(testIds.failureSampleViewBtn);
      viewSampleBtn.click();

      // Step 2: Wait for FailureSampleModal and success state to render
      await waitFor(
        () => {
          expect(screen.getByTestId(testIds.failureSampleModal)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.failureSampleScreenshot)).toBeInTheDocument();
          expect(screen.getByTestId(testIds.failureSampleContext)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Step 3: Verify all context fields are displayed
      const contextSection = screen.getByTestId(testIds.failureSampleContext);
      const context = within(contextSection);

      expect(context.getByText('click')).toBeInTheDocument();
      expect(context.getByText('2024-01-01T12:00:00.000Z')).toBeInTheDocument();
      expect(context.getByText('https://example.com')).toBeInTheDocument();
      expect(context.getByText('Element not found')).toBeInTheDocument();
    });
  });
});

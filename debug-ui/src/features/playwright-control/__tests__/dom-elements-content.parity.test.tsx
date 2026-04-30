import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from '@/app/pages/DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';
import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import * as controlAdapters from '@/features/playwright-control/api/control.adapters.js';

/**
 * Parity test for P4-25-V: DOM Elements content parity
 *
 * Tests that DebugPage's DOM Elements tab renders DomElementsTable and SelectedElementCard correctly.
 * Verifies structural elements, testids, and state management.
 */

// Mock the LiveViewCanvas to avoid canvas rendering issues in JSDOM
vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

// Mock all adapter functions
vi.mock('@/features/playwright-control/api/control.adapters.js', () => ({
  fetchDomSnapshot: vi.fn(),
}));

describe('P4-25-V: DOM Elements Content Parity', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          {ui}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset Zustand store to initial state
    useControlStore.getState().reset();
  });

  it('renders DOM Elements tab container with correct testid', () => {
    renderWithProviders(<DebugPage />);

    const domElementsTab = screen.getByTestId(testIds.rightPanelTabDomElements);

    expect(domElementsTab).toBeInTheDocument();
  });

  it('renders DomElementsTable with correct testid', () => {
    renderWithProviders(<DebugPage />);

    const domElementsTable = screen.getByTestId(testIds.domElementsTable);

    expect(domElementsTable).toBeInTheDocument();
  });

  it('renders SelectedElementCard with correct testid', () => {
    renderWithProviders(<DebugPage />);

    const selectedElementCard = screen.getByTestId(testIds.selectedElementCard);

    expect(selectedElementCard).toBeInTheDocument();
  });

  it('renders marker toggle checkbox in DomElementsTable', () => {
    renderWithProviders(<DebugPage />);

    const markerToggle = screen.getByTestId(testIds.domElementsMarkerToggle);

    expect(markerToggle).toBeInTheDocument();
    expect(markerToggle.tagName).toBe('INPUT');
    expect(markerToggle).toHaveAttribute('type', 'checkbox');
  });

  it('renders Get DOM button in DomElementsTable', () => {
    renderWithProviders(<DebugPage />);

    const getDomBtn = screen.getByTestId(testIds.domElementsGetDomBtn);

    expect(getDomBtn).toBeInTheDocument();
    expect(getDomBtn.tagName).toBe('BUTTON');
    expect(getDomBtn).toHaveTextContent('获取 DOM');
  });

  it('renders DOM elements container in DomElementsTable', () => {
    renderWithProviders(<DebugPage />);

    const domElementsContainer = screen.getByTestId(testIds.domElementsContainer);

    expect(domElementsContainer).toBeInTheDocument();
  });

  it('renders empty state in DOM elements container initially', () => {
    renderWithProviders(<DebugPage />);

    const emptyState = screen.getByTestId(testIds.domElementsEmptyState);

    expect(emptyState).toBeInTheDocument();
    expect(emptyState).toHaveTextContent('点击"获取 DOM"加载元素映射');
  });

  it('toggles marker state when checkbox is clicked', async () => {
    renderWithProviders(<DebugPage />);

    const markerToggle = screen.getByTestId(testIds.domElementsMarkerToggle) as HTMLInputElement;

    expect(markerToggle.checked).toBe(false);

    fireEvent.click(markerToggle);

    await waitFor(() => {
      expect(markerToggle.checked).toBe(true);
    });

    fireEvent.click(markerToggle);

    await waitFor(() => {
      expect(markerToggle.checked).toBe(false);
    });
  });

  it('shows empty state in SelectedElementCard when no element is selected', () => {
    renderWithProviders(<DebugPage />);

    const selectedElementCard = screen.getByTestId(testIds.selectedElementCard);

    expect(selectedElementCard).toHaveTextContent('当前元素');
    expect(selectedElementCard).toHaveTextContent('尚未选择元素');
  });

  it('calls fetchDomSnapshot when Get DOM button is clicked', async () => {
    const mockFetchDomSnapshot = vi.mocked(controlAdapters.fetchDomSnapshot);

    mockFetchDomSnapshot.mockResolvedValue({
      success: true,
      dom: {
        elements_map: [
          [1, { tag: 'div', 'data-nebula-id': 'test-1', text: 'Test 1', bbox: { x: 0, y: 0, width: 100, height: 100 }, isVisible: true, isInteractable: true, locatorBundle: {} }],
        ],
        snapshot_id: 'test-snapshot-123',
      },
    });

    renderWithProviders(<DebugPage />);

    const getDomBtn = screen.getByTestId(testIds.domElementsGetDomBtn);

    fireEvent.click(getDomBtn);

    await waitFor(() => {
      expect(mockFetchDomSnapshot).toHaveBeenCalled();
    });

    expect(mockFetchDomSnapshot).toHaveBeenCalledTimes(1);
  });

  it('updates store with DOM elements after successful fetch', async () => {
    const mockFetchDomSnapshot = vi.mocked(controlAdapters.fetchDomSnapshot);

    mockFetchDomSnapshot.mockResolvedValue({
      success: true,
      dom: {
        elements_map: [
          [1, { tag: 'div', 'data-nebula-id': 'test-1', text: 'Test 1', bbox: { x: 0, y: 0, width: 100, height: 100 }, isVisible: true, isInteractable: true, locatorBundle: {} }],
          [2, { tag: 'button', 'data-nebula-id': 'test-2', text: 'Test 2', bbox: { x: 0, y: 100, width: 200, height: 50 }, isVisible: true, isInteractable: true, locatorBundle: {} }],
        ],
        snapshot_id: 'test-snapshot-456',
      },
    });

    renderWithProviders(<DebugPage />);

    const getDomBtn = screen.getByTestId(testIds.domElementsGetDomBtn);

    fireEvent.click(getDomBtn);

    await waitFor(() => {
      expect(mockFetchDomSnapshot).toHaveBeenCalled();
    });

    // Check that empty state is gone (elements loaded)
    const emptyState = screen.queryByTestId(testIds.domElementsEmptyState);
    expect(emptyState).not.toBeInTheDocument();

    // Check that table rows are present
    const tableRows = screen.getAllByTestId(testIds.domTableRow);
    expect(tableRows).toHaveLength(2);
  });

  it('shows error when fetchDomSnapshot fails', async () => {
    const mockFetchDomSnapshot = vi.mocked(controlAdapters.fetchDomSnapshot);

    mockFetchDomSnapshot.mockResolvedValue({
      success: false,
      error: '获取 DOM 失败',
    });

    renderWithProviders(<DebugPage />);

    const getDomBtn = screen.getByTestId(testIds.domElementsGetDomBtn);

    fireEvent.click(getDomBtn);

    await waitFor(() => {
      expect(mockFetchDomSnapshot).toHaveBeenCalled();
    });

    const errorElement = screen.getByText('获取 DOM 失败');
    expect(errorElement).toBeInTheDocument();
  });

  it('selects element when table row is clicked', async () => {
    const mockFetchDomSnapshot = vi.mocked(controlAdapters.fetchDomSnapshot);

    mockFetchDomSnapshot.mockResolvedValue({
      success: true,
      dom: {
        elements_map: [
          [1, { tag: 'div', 'data-nebula-id': 'test-1', text: 'Test 1', bbox: { x: 0, y: 0, width: 100, height: 100 }, isVisible: true, isInteractable: true, locatorBundle: {} }],
        ],
        snapshot_id: 'test-snapshot-789',
      },
    });

    renderWithProviders(<DebugPage />);

    const getDomBtn = screen.getByTestId(testIds.domElementsGetDomBtn);

    fireEvent.click(getDomBtn);

    await waitFor(() => {
      expect(mockFetchDomSnapshot).toHaveBeenCalled();
    });

    const tableRows = screen.getAllByTestId(testIds.domTableRow);
    fireEvent.click(tableRows[0]);

    await waitFor(() => {
      const selectedElementCard = screen.getByTestId(testIds.selectedElementCard);
      expect(selectedElementCard).toHaveTextContent('当前元素');
      expect(selectedElementCard).toHaveTextContent('div');
      expect(selectedElementCard).toHaveTextContent('Test 1');
    });
  });

  it('verifies at least 5 structural elements have correct testids', () => {
    renderWithProviders(<DebugPage />);

    // Structural elements with testids:
    // 1. DOM Elements tab container
    expect(screen.getByTestId(testIds.rightPanelTabDomElements)).toBeInTheDocument();

    // 2. DomElementsTable
    expect(screen.getByTestId(testIds.domElementsTable)).toBeInTheDocument();

    // 3. Marker toggle checkbox
    expect(screen.getByTestId(testIds.domElementsMarkerToggle)).toBeInTheDocument();

    // 4. Get DOM button
    expect(screen.getByTestId(testIds.domElementsGetDomBtn)).toBeInTheDocument();

    // 5. DOM elements container
    expect(screen.getByTestId(testIds.domElementsContainer)).toBeInTheDocument();

    // 6. SelectedElementCard
    expect(screen.getByTestId(testIds.selectedElementCard)).toBeInTheDocument();

    // 7. Empty state
    expect(screen.getByTestId(testIds.domElementsEmptyState)).toBeInTheDocument();
  });
});

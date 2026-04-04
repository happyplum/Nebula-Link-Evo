import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomElementsTable } from '../DomElementsTable.js';
import { useControlStore } from '../../store/control.store.js';
import { fetchDomSnapshot } from '../../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/control.adapters.js', () => ({
  fetchDomSnapshot: vi.fn(),
}));

describe('DomElementsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useControlStore.getState().reset();
  });

  it('renders empty state initially', () => {
    render(<DomElementsTable />);
    expect(screen.getByText('点击"获取 DOM"加载元素映射')).toBeInTheDocument();
  });

  it('renders error message when fetch fails', async () => {
    vi.mocked(fetchDomSnapshot).mockResolvedValue({ success: false, error: '连接失败' });

    render(<DomElementsTable />);
    fireEvent.click(screen.getByTestId(testIds.domElementsGetDomBtn));

    await waitFor(() => {
      expect(screen.getByText('连接失败')).toBeInTheDocument();
    });
  });

  it('renders elements in table after successful fetch', async () => {
    vi.mocked(fetchDomSnapshot).mockResolvedValue({
      success: true,
      dom: {
        snapshot_id: 'snap-1',
        elements_map: [
          [1, { tag: 'button', text: 'Submit', 'data-nebula-id': 'neb-1', bbox: { x: 1, y: 2, width: 3, height: 4 } }],
          [2, { tag: 'div', text: 'Container', 'data-nebula-id': 'neb-2', bbox: { x: 5, y: 6, width: 7, height: 8 } }],
        ],
      },
    });

    render(<DomElementsTable />);
    fireEvent.click(screen.getByTestId(testIds.domElementsGetDomBtn));

    await waitFor(() => {
      expect(screen.getByText('button')).toBeInTheDocument();
      expect(screen.getByText('div')).toBeInTheDocument();
      expect(screen.getByText('neb-1')).toBeInTheDocument();
      expect(screen.getByText('neb-2')).toBeInTheDocument();
    });
  });

  it('selects element on row click', async () => {
    vi.mocked(fetchDomSnapshot).mockResolvedValue({
      success: true,
      dom: {
        snapshot_id: 'snap-1',
        elements_map: [
          [1, { tag: 'button', text: 'Submit', 'data-nebula-id': 'neb-1', bbox: { x: 1, y: 2, width: 3, height: 4 } }],
        ],
      },
    });

    render(<DomElementsTable />);
    fireEvent.click(screen.getByTestId(testIds.domElementsGetDomBtn));

    await waitFor(() => {
      expect(screen.getByText('button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId(testIds.domTableRow));

    expect(useControlStore.getState().selectedElement).toEqual({
      selector: '[data-nebula-id="neb-1"]',
      tag: 'button',
      text: 'Submit',
      attributes: { id: 'neb-1', 'data-nebula-id': 'neb-1' },
      markerNumber: 1,
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      dataNebulaId: 'neb-1',
    });
  });
});

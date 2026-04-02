import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DomElementsTable } from '../DomElementsTable.js';
import { useControlStore } from '../../store/control.store.js';
import { getElements } from '../../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/control.adapters.js', () => ({
  getElements: vi.fn(),
}));

describe('DomElementsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useControlStore.setState({
      selectedElement: null,
      consoleMessages: [],
      isExecutingAction: false,
      lastActionError: null,
      viewport: null,
    });
  });

  it('renders loading state initially', () => {
    vi.mocked(getElements).mockImplementation(() => new Promise(() => {})); // Never resolves
    
    render(<DomElementsTable />);
    
    expect(screen.getByText('Loading elements...')).toBeInTheDocument();
  });

  it('renders empty state when no elements returned', async () => {
    vi.mocked(getElements).mockResolvedValue({ success: true, elements: [] });
    
    render(<DomElementsTable />);
    
    await waitFor(() => {
      expect(screen.getByText('No elements found')).toBeInTheDocument();
    });
  });

  it('renders elements in table', async () => {
    vi.mocked(getElements).mockResolvedValue({
      success: true,
      elements: [
        { tag: 'button', id: 'submit', class: 'btn primary', text: 'Submit', isVisible: true, isInteractable: true },
        { tag: 'div', class: 'container', isVisible: true, isInteractable: false },
      ]
    });
    
    render(<DomElementsTable />);
    
    await waitFor(() => {
      expect(screen.getByText('button')).toBeInTheDocument();
      expect(screen.getByText('submit')).toBeInTheDocument();
      expect(screen.getByText('btn primary')).toBeInTheDocument();
      expect(screen.getByText('Submit')).toBeInTheDocument();
      
      expect(screen.getByText('div')).toBeInTheDocument();
      expect(screen.getByText('container')).toBeInTheDocument();
    });
  });

  it('selects element on row click', async () => {
    vi.mocked(getElements).mockResolvedValue({
      success: true,
      elements: [
        { tag: 'button', id: 'submit', class: 'btn primary', text: 'Submit' },
      ]
    });
    
    render(<DomElementsTable />);
    
    await waitFor(() => {
      expect(screen.getByText('button')).toBeInTheDocument();
    });
    
    fireEvent.click(screen.getByTestId(testIds.domTableRow));
    
    const state = useControlStore.getState();
    expect(state.selectedElement).toEqual({
      selector: 'button#submit',
      tag: 'button',
      text: 'Submit',
      attributes: {
        id: 'submit',
        class: 'btn primary'
      }
    });
  });

  it('displays error message when fetch fails', async () => {
    vi.mocked(getElements).mockResolvedValue({ success: false, error: 'Failed to connect' });
    
    render(<DomElementsTable />);
    
    await waitFor(() => {
      expect(screen.getByText('Failed to connect')).toBeInTheDocument();
    });
  });

  it('refreshes elements when refresh button is clicked', async () => {
    vi.mocked(getElements).mockResolvedValueOnce({ success: true, elements: [] });
    
    render(<DomElementsTable />);
    
    await waitFor(() => {
      expect(screen.getByText('No elements found')).toBeInTheDocument();
    });
    
    vi.mocked(getElements).mockResolvedValueOnce({
      success: true,
      elements: [{ tag: 'span', text: 'New element' }]
    });
    
    fireEvent.click(screen.getByText('Refresh'));
    
    await waitFor(() => {
      expect(screen.getByText('span')).toBeInTheDocument();
      expect(screen.getByText('New element')).toBeInTheDocument();
    });
  });
});

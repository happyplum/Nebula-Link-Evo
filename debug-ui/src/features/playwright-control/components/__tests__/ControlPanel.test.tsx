import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ControlPanel } from '../ControlPanel.js';
import { useControlStore } from '../../store/control.store.js';
import { executeAction, evaluateExpression, takeScreenshot } from '../../api/control.adapters.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../api/control.adapters.js', () => ({
  executeAction: vi.fn(),
  evaluateExpression: vi.fn(),
  takeScreenshot: vi.fn(),
}));

describe('ControlPanel', () => {
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

  it('renders all action buttons', () => {
    render(<ControlPanel />);
    
    expect(screen.getByTestId(`${testIds.actionButton}-click`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-hover`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-scroll-down`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-scroll-up`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-screenshot`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-type`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-evaluate`)).toBeInTheDocument();
    expect(screen.getByTestId(`${testIds.actionButton}-navigate`)).toBeInTheDocument();
  });

  it('disables element-specific buttons when no element is selected', () => {
    render(<ControlPanel />);
    
    expect(screen.getByTestId(`${testIds.actionButton}-click`)).toBeDisabled();
    expect(screen.getByTestId(`${testIds.actionButton}-hover`)).toBeDisabled();
    expect(screen.getByTestId(`${testIds.actionButton}-type`)).toBeDisabled();
    
    // These should be enabled even without selection
    expect(screen.getByTestId(`${testIds.actionButton}-scroll-down`)).not.toBeDisabled();
    expect(screen.getByTestId(`${testIds.actionButton}-screenshot`)).not.toBeDisabled();
  });

  it('enables element-specific buttons when element is selected', () => {
    useControlStore.setState({
      selectedElement: { tag: 'button', selector: 'button#submit' }
    });
    
    render(<ControlPanel />);
    
    expect(screen.getByTestId(`${testIds.actionButton}-click`)).not.toBeDisabled();
    expect(screen.getByTestId(`${testIds.actionButton}-hover`)).not.toBeDisabled();
    // Type is still disabled because input is empty
    expect(screen.getByTestId(`${testIds.actionButton}-type`)).toBeDisabled();
  });

  it('calls executeAction when click button is clicked', async () => {
    vi.mocked(executeAction).mockResolvedValue({ success: true });
    
    useControlStore.setState({
      selectedElement: { tag: 'button', selector: 'button#submit' }
    });
    
    render(<ControlPanel />);
    
    fireEvent.click(screen.getByTestId(`${testIds.actionButton}-click`));
    
    expect(executeAction).toHaveBeenCalledWith('click', { selector: 'button#submit' });
    
    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  it('calls executeAction when type button is clicked with input', async () => {
    vi.mocked(executeAction).mockResolvedValue({ success: true });
    
    useControlStore.setState({
      selectedElement: { tag: 'input', selector: 'input#name' }
    });
    
    render(<ControlPanel />);
    
    const input = screen.getByPlaceholderText('Text to type...');
    fireEvent.change(input, { target: { value: 'Hello World' } });
    
    const typeButton = screen.getByTestId(`${testIds.actionButton}-type`);
    expect(typeButton).not.toBeDisabled();
    
    fireEvent.click(typeButton);
    
    expect(executeAction).toHaveBeenCalledWith('type', { selector: 'input#name', text: 'Hello World' });
    
    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  it('calls evaluateExpression when eval button is clicked', async () => {
    vi.mocked(evaluateExpression).mockResolvedValue({ success: true, result: 'ok' });
    
    render(<ControlPanel />);
    
    const input = screen.getByPlaceholderText('Text to type...');
    fireEvent.change(input, { target: { value: 'document.title' } });
    
    const evalButton = screen.getByTestId(`${testIds.actionButton}-evaluate`);
    expect(evalButton).not.toBeDisabled();
    
    fireEvent.click(evalButton);
    
    expect(evaluateExpression).toHaveBeenCalledWith('document.title');
    
    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  it('calls executeAction when navigate button is clicked', async () => {
    vi.mocked(executeAction).mockResolvedValue({ success: true });
    
    render(<ControlPanel />);
    
    const input = screen.getByPlaceholderText('URL to navigate...');
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    
    const navButton = screen.getByTestId(`${testIds.actionButton}-navigate`);
    expect(navButton).not.toBeDisabled();
    
    fireEvent.click(navButton);
    
    expect(executeAction).toHaveBeenCalledWith('navigate', { url: 'https://example.com' });
    
    await waitFor(() => {
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  it('displays error message when action fails', async () => {
    vi.mocked(executeAction).mockResolvedValue({ success: false, error: 'Element not found' });
    
    useControlStore.setState({
      selectedElement: { tag: 'button', selector: 'button#submit' }
    });
    
    render(<ControlPanel />);
    
    fireEvent.click(screen.getByTestId(`${testIds.actionButton}-click`));
    
    await waitFor(() => {
      expect(screen.getByText('Element not found')).toBeInTheDocument();
    });
  });
});

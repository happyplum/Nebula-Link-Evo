import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Toast, ToastContainer, toastManager } from '../Toast.js';
import { testIds } from '../../testing/testids.js';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correctly', () => {
    render(<Toast type="success" message="Operation successful" />);
    expect(screen.getByTestId(`${testIds.toastSuccess}`)).toBeInTheDocument();
    expect(screen.getByText('Operation successful')).toBeInTheDocument();
  });

  it('calls onClose after duration', () => {
    const onClose = vi.fn();
    render(<Toast type="info" message="Info" duration={3000} onClose={onClose} />);
    
    expect(onClose).not.toHaveBeenCalled();
    
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Toast type="error" message="Error" onClose={onClose} />);
    
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ToastContainer', () => {
  it('renders toasts added via manager', () => {
    render(<ToastContainer />);
    
    act(() => {
      toastManager.add({ type: 'warning', message: 'Warning message' });
    });
    
    expect(screen.getByTestId(`${testIds.toastWarning}`)).toBeInTheDocument();
    expect(screen.getByText('Warning message')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusIndicator } from '../StatusIndicator.js';
import { testIds } from '../../testing/testids.js';

describe('StatusIndicator', () => {
  it('renders correctly', () => {
    render(<StatusIndicator status="online" />);
    expect(screen.getByTestId(testIds.statusIndicator)).toBeInTheDocument();
  });

  it('renders with a label', () => {
    render(<StatusIndicator status="offline" label="System Offline" />);
    expect(screen.getByText('System Offline')).toBeInTheDocument();
  });

  it('applies status classes correctly', () => {
    const { container: containerOnline } = render(<StatusIndicator status="online" />);
    expect(containerOnline.firstChild?.firstChild).toHaveClass(/online/);

    const { container: containerError } = render(<StatusIndicator status="error" />);
    expect(containerError.firstChild?.firstChild).toHaveClass(/error/);
  });

  it('applies size classes correctly', () => {
    const { container: containerSm } = render(<StatusIndicator status="online" size="sm" />);
    expect(containerSm.firstChild?.firstChild).toHaveClass(/sm/);

    const { container: containerLg } = render(<StatusIndicator status="online" size="lg" />);
    expect(containerLg.firstChild?.firstChild).toHaveClass(/lg/);
  });
});

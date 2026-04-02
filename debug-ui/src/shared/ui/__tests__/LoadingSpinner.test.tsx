import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoadingSpinner } from '../LoadingSpinner.js';
import { testIds } from '../../testing/testids.js';

describe('LoadingSpinner', () => {
  it('renders correctly', () => {
    render(<LoadingSpinner />);
    expect(screen.getByTestId(testIds.loadingSpinner)).toBeInTheDocument();
  });

  it('renders with a label', () => {
    render(<LoadingSpinner label="Loading data..." />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('applies size classes correctly', () => {
    const { container: containerSm } = render(<LoadingSpinner size="sm" />);
    expect(containerSm.firstChild).toHaveClass(/sm/);

    const { container: containerLg } = render(<LoadingSpinner size="lg" />);
    expect(containerLg.firstChild).toHaveClass(/lg/);
  });
});

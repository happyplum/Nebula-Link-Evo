import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Accordion } from '../Accordion.js';

describe('Accordion Parity Test', () => {
  const defaultProps = {
    open: false,
    onToggle: vi.fn(),
    title: 'Test Title',
    children: <div>Test Content</div>,
  };

  it('renders with title', () => {
    render(<Accordion {...defaultProps} />);

    const header = screen.getByRole('button', { name: /Test Title/i });
    expect(header).toBeInTheDocument();
    expect(header).toHaveTextContent('Test Title');
  });

  it('shows content when open=true', () => {
    render(<Accordion {...defaultProps} open={true} />);

    const content = document.getElementById('accordion-content');
    expect(content).toBeInTheDocument();
    expect(content).toHaveTextContent('Test Content');
  });

  it('hides content when open=false', () => {
    render(<Accordion {...defaultProps} open={false} />);

    const root = screen.getByTestId('accordion');
    expect(root).not.toHaveClass(/_open_/);
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(<Accordion {...defaultProps} onToggle={onToggle} />);

    const header = screen.getByTestId('accordion-header');
    fireEvent.click(header);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('aria-expanded attribute reflects open state', () => {
    const { rerender } = render(<Accordion {...defaultProps} open={false} />);

    const header = screen.getByTestId('accordion-header');
    expect(header).toHaveAttribute('aria-expanded', 'false');

    rerender(<Accordion {...defaultProps} open={true} />);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('content has aria-labelledby referencing header id', () => {
    render(<Accordion {...defaultProps} open={true} testId="custom-accordion" />);

    const content = document.getElementById('custom-accordion-content');
    expect(content).toHaveAttribute('aria-labelledby', 'custom-accordion-header');
  });

  it('custom testId prop works', () => {
    render(
      <Accordion {...defaultProps} open={true} testId="custom-accordion" />
    );

    const root = screen.getByTestId('custom-accordion');
    const header = screen.getByTestId('custom-accordion-header');
    const content = document.getElementById('custom-accordion-content');

    expect(root).toBeInTheDocument();
    expect(header).toBeInTheDocument();
    expect(content).toBeInTheDocument();
  });

  it('renders icon slot if provided', () => {
    const icon = <span data-testid="test-icon">Icon</span>;
    render(<Accordion {...defaultProps} icon={icon} />);

    const iconElement = screen.getByTestId('test-icon');
    expect(iconElement).toBeInTheDocument();
  });

  it('renders chevron icon in header', () => {
    render(<Accordion {...defaultProps} />);

    const header = screen.getByTestId('accordion-header');
    const chevron = header.querySelector('[aria-hidden="true"]');
    expect(chevron).toBeInTheDocument();
  });

  it('header has aria-controls referencing content id', () => {
    render(<Accordion {...defaultProps} testId="test-accordion" />);

    const header = screen.getByTestId('test-accordion-header');
    expect(header).toHaveAttribute('aria-controls', 'test-accordion-content');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperationLogsShell } from '../OperationLogsShell.js';
import { testIds } from '@/shared/testing/testids.js';

describe('OperationLogsShell Parity Test', () => {
  const defaultProps = {
    open: false,
    onToggle: vi.fn(),
  };

  it('renders Accordion with correct testid', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const accordion = screen.getByTestId(testIds.controlOperationLogs);
    expect(accordion).toBeInTheDocument();
  });

  it('renders log container with correct testid', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const logContainer = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logContainer).toBeInTheDocument();
  });

  it('renders clear logs button with correct testid', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const clearBtn = screen.getByTestId(testIds.controlOperationLogsClearBtn);
    expect(clearBtn).toBeInTheDocument();
    expect(clearBtn).toHaveTextContent('清空日志');
  });

  it('renders empty state message in log container', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const logContainer = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logContainer).toHaveTextContent('暂无日志');
  });

  it('renders Accordion title "📝 操作日志"', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const accordion = screen.getByTestId(testIds.controlOperationLogs);
    expect(accordion).toHaveTextContent('📝 操作日志');
  });

  it('calls onToggle when Accordion header is clicked', () => {
    const onToggle = vi.fn();
    render(<OperationLogsShell {...defaultProps} onToggle={onToggle} />);

    // The Accordion component has a header button that triggers onToggle
    const header = screen.getByTestId(`${testIds.controlOperationLogs}-header`);
    fireEvent.click(header);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('clear button is a button element with type="button"', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const clearBtn = screen.getByTestId(testIds.controlOperationLogsClearBtn);
    expect(clearBtn.tagName).toBe('BUTTON');
    expect(clearBtn).toHaveAttribute('type', 'button');
  });

  it('log container is a div element', () => {
    render(<OperationLogsShell {...defaultProps} />);

    const logContainer = screen.getByTestId(testIds.controlOperationLogsContainer);
    expect(logContainer.tagName).toBe('DIV');
  });
});

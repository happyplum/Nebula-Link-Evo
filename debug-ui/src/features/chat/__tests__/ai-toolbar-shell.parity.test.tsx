import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiToolbarShell } from '@/features/chat/components/AiToolbarShell.js';
import { testIds } from '@/shared/testing/testids.js';

/**
 * Parity test for P2-12: AI Toolbar and State Controls Shell
 *
 * Tests structural rendering and testid placement for AiToolbarShell.
 * Verifies that the component renders all expected regions with correct testids.
 */
describe('P2-12: AI Toolbar and State Controls Shell - Parity', () => {
  it('renders toolbar container with correct testid', () => {
    render(<AiToolbarShell />);
    expect(screen.getByTestId(testIds.aiToolbar)).toBeInTheDocument();
  });

  it('renders session selector with correct testid', () => {
    render(<AiToolbarShell />);
    expect(screen.getByTestId(testIds.aiToolbarSessionSelect)).toBeInTheDocument();
  });

  it('renders new session button with correct testid', () => {
    render(<AiToolbarShell />);
    expect(screen.getByTestId(testIds.aiToolbarNewSessionBtn)).toBeInTheDocument();
  });

  it('renders clear session button with correct testid', () => {
    render(<AiToolbarShell />);
    expect(screen.getByTestId(testIds.aiToolbarClearSessionBtn)).toBeInTheDocument();
  });

  it('renders stop generation button with correct testid', () => {
    render(<AiToolbarShell />);
    expect(screen.getByTestId(testIds.aiToolbarStopBtn)).toBeInTheDocument();
  });

  it('renders all 5 structural elements with correct testids', () => {
    render(<AiToolbarShell />);

    // Verify all elements exist
    expect(screen.getByTestId(testIds.aiToolbar)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.aiToolbarSessionSelect)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.aiToolbarNewSessionBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.aiToolbarClearSessionBtn)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.aiToolbarStopBtn)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from '../Composer.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectStreamingState: (s: any) => s.streamingState,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

describe('Composer', () => {
  const mockAddOptimisticMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    (useChatStore as any).mockImplementation((selector: any) => {
      if (selector.name === 'selectStreamingState') return 'idle';
      if (selector.name === 'selectActiveSessionId') return 'session-1';
      return mockAddOptimisticMessage;
    });
  });

  it('renders input and send button', () => {
    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.sendButton)).toBeInTheDocument();
  });

  it('disables input when streaming', () => {
    (useChatStore as any).mockImplementation((selector: any) => {
      if (selector.name === 'selectStreamingState') return 'streaming';
      if (selector.name === 'selectActiveSessionId') return 'session-1';
      return mockAddOptimisticMessage;
    });

    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeDisabled();
    expect(screen.getByTestId(testIds.sendButton)).toBeDisabled();
  });

  it('disables input when no active session', () => {
    (useChatStore as any).mockImplementation((selector: any) => {
      if (selector.name === 'selectStreamingState') return 'idle';
      if (selector.name === 'selectActiveSessionId') return null;
      return mockAddOptimisticMessage;
    });

    render(<Composer />);
    expect(screen.getByTestId(testIds.composerInput)).toBeDisabled();
    expect(screen.getByTestId(testIds.sendButton)).toBeDisabled();
  });

  it('calls addOptimisticMessage on send', () => {
    render(<Composer />);
    
    const input = screen.getByTestId(testIds.composerInput);
    const button = screen.getByTestId(testIds.sendButton);
    
    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(button).not.toBeDisabled();
    
    fireEvent.click(button);
    
    expect(mockAddOptimisticMessage).toHaveBeenCalledWith('session-1', 'Hello world');
    expect(input).toHaveValue('');
  });
});

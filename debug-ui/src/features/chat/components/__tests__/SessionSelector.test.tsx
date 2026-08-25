import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionSelector } from '../SessionSelector.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectSessions: (s: any) => s.sessions,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

describe('SessionSelector', () => {
  const mockSetActiveSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    (useChatStore as any).mockImplementation((selector: any) => {
      if (selector.name === 'selectSessions')
        return [
          { id: 'session-1', title: 'First Session' },
          { id: 'session-2', title: 'Second Session' },
        ];
      if (selector.name === 'selectActiveSessionId') return 'session-1';
      return mockSetActiveSession;
    });
  });

  it('renders sessions in dropdown', () => {
    render(<SessionSelector />);

    const select = screen.getByTestId(testIds.sessionSelector);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('session-1');

    expect(screen.getByText('First Session')).toBeInTheDocument();
    expect(screen.getByText('Second Session')).toBeInTheDocument();
  });

  it('calls setActiveSession on change', () => {
    render(<SessionSelector />);

    const select = screen.getByTestId(testIds.sessionSelector);
    fireEvent.change(select, { target: { value: 'session-2' } });

    expect(mockSetActiveSession).toHaveBeenCalledWith('session-2');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from '../ChatPanel.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

// Mock the store
vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectSessions: (s: any) => s.sessions,
  selectActiveSessionId: (s: any) => s.activeSessionId,
  selectActiveMessages: (s: any) => s.activeSessionId ? (s.messagesBySession[s.activeSessionId] || []) : [],
  selectStreamingState: (s: any) => s.streamingState,
}));

describe('ChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation
    (useChatStore as any).mockImplementation((selector: any) => {
      const state = {
        sessions: [],
        activeSessionId: null,
        messagesBySession: {},
        streamingState: 'idle',
        setActiveSession: vi.fn(),
        addOptimisticMessage: vi.fn(),
      };
      return selector(state);
    });
  });

  it('renders all sub-components', () => {
    render(<ChatPanel />);
    
    expect(screen.getByTestId(testIds.chatPanel)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.sessionSelector)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.statusBar)).toBeInTheDocument();
    expect(screen.getByTestId(testIds.composerInput)).toBeInTheDocument();
  });
});

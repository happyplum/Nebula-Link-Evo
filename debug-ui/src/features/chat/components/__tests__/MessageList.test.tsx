import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectActiveMessages: (s: any) => s.activeSessionId ? (s.messagesBySession[s.activeSessionId] || []) : [],
  selectActiveSessionId: (s: any) => s.activeSessionId,
  selectStreamingState: (s: any) => s.streamingState,
  selectStreamingContent: (s: any) => s.streamingContent,
  selectStreamingThinking: (s: any) => s.streamingThinking,
  selectShowThinking: (s: any) => s.showThinking,
}));

describe('MessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    (useChatStore as any).mockImplementation((selector: any) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        messagesBySession: { 'session-1': [] },
        visibleMessageCounts: {},
        expandVisibleMessages: vi.fn(),
      }),
    );

    render(<MessageList />);
    
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getByText('No messages yet. Start a conversation!')).toBeInTheDocument();
  });

  it('renders messages when present', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there' },
    ];

    (useChatStore as any).mockImplementation((selector: any) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: false,
        streamingState: 'idle',
        streamingContent: '',
        streamingThinking: '',
        messagesBySession: { 'session-1': messages },
        visibleMessageCounts: { 'session-1': 50 },
        expandVisibleMessages: vi.fn(),
      }),
    );

    render(<MessageList />);
    
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getAllByTestId(testIds.messageBubble)).toHaveLength(2);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('renders streaming assistant thinking even when there are no persisted messages yet', () => {
    (useChatStore as any).mockImplementation((selector: any) =>
      selector({
        activeSessionId: 'session-1',
        showThinking: true,
        streamingState: 'streaming',
        streamingContent: '',
        streamingThinking: 'Analyzing next step...',
        messagesBySession: { 'session-1': [] },
        visibleMessageCounts: {},
        expandVisibleMessages: vi.fn(),
      }),
    );

    render(<MessageList />);

    expect(screen.queryByText('No messages yet. Start a conversation!')).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.thinkingBlock)).toBeInTheDocument();
    expect(screen.getByText('Analyzing next step...')).toBeInTheDocument();
  });
});

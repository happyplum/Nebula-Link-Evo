import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList.js';
import { useChatStore } from '../../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('../../store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectActiveMessages: (s: any) => s.activeSessionId ? (s.messagesBySession[s.activeSessionId] || []) : [],
}));

describe('MessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no messages', () => {
    (useChatStore as any).mockImplementation(() => []);

    render(<MessageList />);
    
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getByText('No messages yet. Start a conversation!')).toBeInTheDocument();
  });

  it('renders messages when present', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there' },
    ];
    
    (useChatStore as any).mockImplementation(() => messages);

    render(<MessageList />);
    
    expect(screen.getByTestId(testIds.messageList)).toBeInTheDocument();
    expect(screen.getAllByTestId(testIds.messageBubble)).toHaveLength(2);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });
});

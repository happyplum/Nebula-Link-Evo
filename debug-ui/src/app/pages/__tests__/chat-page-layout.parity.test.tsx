import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import ChatPage from '@/app/pages/ChatPage.js';
import { useChatStore } from '@/features/chat/store/chat.store.js';
import { apiClient } from '@/shared/api/client.js';
import { testIds } from '@/shared/testing/testids.js';

vi.mock('@/features/config/api/config.queries.js', () => ({
  useConfig: () => ({ data: { decision: { provider: 'glm', model: 'glm-4.6v-flash' } } }),
}));

vi.mock('@/shared/query/hooks.js', () => ({
  useSessions: () => ({ data: { sessions: [] }, isFetching: false }),
  useSessionMessages: () => ({ data: { messages: [] }, isFetching: false }),
}));

vi.mock('@/shared/query/query-client.js', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/shared/api/client.js', () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({ id: 'sess-created', title: '新会话' }),
  },
}));

// Mock Zustand store — must include all named exports used by ChatPage
vi.mock('@/features/chat/store/chat.store.js', () => ({
  useChatStore: vi.fn(),
  selectShowThinking: (s: any) => s.showThinking,
  selectStreamingState: (s: any) => s.streamingState,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

// Mock the chat components that are already tested elsewhere
vi.mock('@/features/chat/components/index.js', () => ({
  SessionSelector: () => (
    <select data-testid={testIds.sessionSelector}>
      <option>Select session...</option>
    </select>
  ),
  MessageList: () => <div data-testid={testIds.messageList}>No messages yet.</div>,
  Composer: () => (
    <div>
      <textarea data-testid={testIds.composerInput} placeholder="Type a message..." />
      <button type="button" data-testid={testIds.sendButton}>
        Send
      </button>
    </div>
  ),
}));

// Helper to mock store state
const mockStore = {
  streamingState: 'idle' as 'idle' | 'streaming' | 'paused' | 'error',
  activeSessionId: null as string | null,
  showThinking: false,
  addSession: vi.fn(),
  removeSession: vi.fn(),
  setActiveSession: vi.fn(),
  setStreamingState: vi.fn(),
  setShowThinking: vi.fn(),
  setSelectedModel: vi.fn(),
  updateSession: vi.fn(),
  setSessions: vi.fn(),
  setMessages: vi.fn(),
  setIsLoadingSessions: vi.fn(),
  setIsLoadingMessages: vi.fn(),
};

describe('ChatPage Layout Parity', () => {
  beforeEach(() => {
    // Reset mock store to default state before each test
    mockStore.streamingState = 'idle';
    mockStore.activeSessionId = null;
    vi.spyOn(window, 'prompt').mockReturnValue('新会话');
    vi.clearAllMocks();
    vi.mocked(apiClient.post).mockResolvedValue({ id: 'sess-created', title: '新会话' });
  });

  it('renders chat page root with correct testid', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const chatPage = screen.getByTestId(testIds.chatPageRoot);
    expect(chatPage).toBeInTheDocument();
  });

  it('renders session selector in header', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const sessionSelector = screen.getByTestId(testIds.sessionSelector);
    expect(sessionSelector).toBeInTheDocument();
  });

  it('renders message list area', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const messageList = screen.getByTestId(testIds.messageList);
    expect(messageList).toBeInTheDocument();
  });

  it('renders composer with textarea', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const composerInput = screen.getByTestId(testIds.composerInput);
    expect(composerInput).toBeInTheDocument();
  });

  it('renders composer area in footer', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const composer = screen.getByPlaceholderText(/Type a message/i);
    expect(composer).toBeInTheDocument();
  });

  it('renders CoT toggle checkbox', () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const cotToggle = screen.getByLabelText(/CoT/i);
    expect(cotToggle).toBeInTheDocument();
  });

  it('calls addSession and setActiveSession when new session button is clicked', async () => {
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const newSessionBtn = screen.getByTitle('新建会话');
    fireEvent.click(newSessionBtn);

    await waitFor(() => {
      expect(mockStore.addSession).toHaveBeenCalled();
      expect(mockStore.setActiveSession).toHaveBeenCalled();
    });
  });

  it('calls setStreamingState when interrupt button is clicked', () => {
    mockStore.streamingState = 'streaming';
    vi.mocked(useChatStore).mockImplementation((selector) => selector(mockStore as any));
    render(<ChatPage />);

    const interruptBtn = screen.getByRole('button', { name: /打断/ });
    fireEvent.click(interruptBtn);
    expect(mockStore.setStreamingState).toHaveBeenCalledWith('idle');
  });
});

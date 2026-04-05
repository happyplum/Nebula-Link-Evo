import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import ChatPage from './ChatPage.js';
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

vi.mock('@/features/chat/store/chat.store.js', () => ({
  useChatStore: vi.fn((selector: (s: any) => unknown) =>
    selector({
      streamingState: 'idle',
      activeSessionId: null,
      showThinking: false,
      selectedModel: 'decision',
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
    }),
  ),
  selectShowThinking: (s: any) => s.showThinking,
  selectSelectedModel: (s: any) => s.selectedModel,
  selectStreamingState: (s: any) => s.streamingState,
  selectActiveSessionId: (s: any) => s.activeSessionId,
}));

// Mock chat sub-components used by ChatPage
vi.mock('@/features/chat/components/index.js', () => ({
  SessionSelector: () => <div data-testid={testIds.sessionSelector}>SessionSelector</div>,
  MessageList: () => <div data-testid={testIds.messageList}>MessageList</div>,
  Composer: () => <textarea data-testid={testIds.composerInput} />,
}));

describe('ChatPage Layout', () => {
  it('renders with CSS Module class on root container', () => {
    const { container } = render(<ChatPage />);
    const rootElement = container.firstElementChild;
    
    expect(rootElement).toBeInTheDocument();
    // CSS Modules hash class names, so check if the class name contains 'fullPage'
    const className = rootElement?.className || '';
    expect(className).toMatch(/fullPage/);
  });

  it('renders root container with data-testid', () => {
    const { container } = render(<ChatPage />);
    const rootElement = container.firstElementChild;
    
    expect(rootElement).toBeInTheDocument();
    expect(rootElement).toHaveAttribute('data-testid', testIds.chatPageRoot);
  });
});
